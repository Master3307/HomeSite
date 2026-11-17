#!/usr/bin/env python3
"""
A real terminal (pty) for the /hub console, without native Node modules.

Two ways to run it (started by server/services/hubTerminal.cjs):

1. Attached (simple):
       python3 pty-helper.py <cols> <rows> <shell> [args...]
   stdin  -> keystrokes for the shell
   stdout <- everything the shell prints
   fd 3   -> control lines: "<cols> <rows>\\n" resizes the terminal
   Exits with the shell's exit code. Dies with the account API.

2. Detached (survives the account API being stopped or restarted):
       python3 pty-helper.py --serve <socket> <ttl-seconds> <cols> <rows> <shell> [args...]
   Detaches itself from the account API (double fork + setsid, so stopping
   the API and its children, e.g. temp-server-stop, doesn't reach the shell),
   then serves the shell on a Unix socket (only this user can open it). It
   keeps the last OUTPUT_KEEP bytes of output, so a restarted API can attach
   again and show what happened meanwhile. Prints "ready <pid>" once the
   socket is listening, then the starting process exits.

   Frames both ways: 1 byte type + 4 bytes length (big endian) + payload.
     API -> helper: i = keystrokes, r = "<cols> <rows>", k = end the shell
     helper -> API: b = the kept output (sent once on connect), o = output,
                    x = the shell's exit code (as text)
   One API connection at a time (a new one replaces the old). With nobody
   attached for <ttl-seconds>, the shell is ended (no orphans forever).
"""
import errno
import fcntl
import os
import pty
import select
import signal
import socket
import struct
import sys
import termios
import time

OUTPUT_KEEP = 4 * 1024 * 1024


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def start_shell(command, cols, rows):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.environ["COLORTERM"] = "truecolor"
        try:
            os.execvp(command[0], command)
        except OSError as error:
            sys.stderr.write(f"Could not start {command[0]}: {error}\n")
            os._exit(127)
    set_size(fd, cols, rows)
    os.kill(pid, signal.SIGWINCH)
    return pid, fd


def write_all(fd, data):
    while data:
        written = os.write(fd, data)
        data = data[written:]


# ---------- 1. attached ----------


def attached(cols, rows, command):
    pid, fd = start_shell(command, cols, rows)
    stdin = sys.stdin.fileno()
    stdout = sys.stdout.fileno()
    control = 3
    control_buffer = b""
    sources = [fd, stdin, control]

    while True:
        try:
            ready, _, _ = select.select(sources, [], [], 1.0)
        except InterruptedError:
            continue

        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break  # the shell closed the terminal
                raise
            if not data:
                break
            os.write(stdout, data)

        if stdin in ready:
            data = os.read(stdin, 65536)
            if not data:
                sources.remove(stdin)
                os.kill(pid, signal.SIGHUP)
            else:
                write_all(fd, data)

        if control in ready:
            data = os.read(control, 4096)
            if not data:
                sources.remove(control)
            control_buffer += data
            while b"\n" in control_buffer:
                line, control_buffer = control_buffer.split(b"\n", 1)
                try:
                    new_cols, new_rows = (int(part) for part in line.split())
                    set_size(fd, max(2, new_cols), max(2, new_rows))
                    os.kill(pid, signal.SIGWINCH)
                except (ValueError, OSError):
                    pass

        # The shell may have exited while output is still buffered.
        finished, status = os.waitpid(pid, os.WNOHANG)
        if finished:
            try:
                while True:
                    data = os.read(fd, 65536)
                    if not data:
                        break
                    os.write(stdout, data)
            except OSError:
                pass
            sys.exit(os.waitstatus_to_exitcode(status))

    _, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))


# ---------- 2. detached ----------


def frame(kind, payload=b""):
    return kind + struct.pack(">I", len(payload)) + payload


class Client:
    def __init__(self, conn):
        self.conn = conn
        self.inbox = b""
        self.outbox = b""

    def fileno(self):
        return self.conn.fileno()


def detached(path, ttl, cols, rows, command):
    # Tell the starting process when the socket listens (or that it failed).
    read_end, write_end = os.pipe()
    if os.fork() > 0:
        os.close(write_end)
        message = os.read(read_end, 200).decode(errors="replace").strip()
        print(message, flush=True)
        sys.exit(0 if message.startswith("ready") else 1)
    os.close(read_end)
    os.setsid()
    if os.fork() > 0:
        os._exit(0)

    # From here on: detached. Nothing of the account API stays open.
    null = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(null, fd)
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)

    try:
        old_umask = os.umask(0o077)
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        server.bind(path)
        server.listen(2)
        os.umask(old_umask)
        server.setblocking(False)
        pid, fd = start_shell(command, cols, rows)
    except Exception as error:  # noqa: BLE001 - reported to the starting process
        os.write(write_end, f"error {error}".encode())
        os._exit(1)
    os.write(write_end, f"ready {os.getpid()}".encode())
    os.close(write_end)

    kept = bytearray()
    client = None
    alone_since = time.monotonic()
    exit_code = None

    def drop_client():
        nonlocal client, alone_since
        if client:
            try:
                client.conn.close()
            except OSError:
                pass
        client = None
        alone_since = time.monotonic()

    def send(kind, payload=b""):
        if client:
            client.outbox += frame(kind, payload)

    def handle(kind, payload):
        if kind == b"i":
            try:
                write_all(fd, payload)
            except OSError:
                pass
        elif kind == b"r":
            try:
                new_cols, new_rows = (int(part) for part in payload.split())
                set_size(fd, max(2, new_cols), max(2, new_rows))
                os.kill(pid, signal.SIGWINCH)
            except (ValueError, OSError):
                pass
        elif kind == b"k":
            try:
                os.kill(pid, signal.SIGHUP)
            except OSError:
                pass

    shell_open = True
    while True:
        readers = [server] + ([fd] if shell_open else []) + ([client] if client else [])
        writers = [client] if client and client.outbox else []
        try:
            ready, writable, _ = select.select(readers, writers, [], 1.0)
        except InterruptedError:
            continue

        if server in ready:
            try:
                conn, _ = server.accept()
                conn.setblocking(False)
                drop_client()  # a new connection replaces the old one
                client = Client(conn)
                client.outbox += frame(b"b", bytes(kept))
            except OSError:
                pass

        if shell_open and fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if data:
                kept += data
                if len(kept) > OUTPUT_KEEP:
                    del kept[: len(kept) - OUTPUT_KEEP]
                send(b"o", data)
            else:
                shell_open = False

        if client and client in ready:
            try:
                data = client.conn.recv(65536)
            except OSError:
                data = b""
            if not data:
                drop_client()
            else:
                client.inbox += data
                while len(client.inbox) >= 5:
                    length = struct.unpack(">I", client.inbox[1:5])[0]
                    if len(client.inbox) < 5 + length:
                        break
                    kind, payload = client.inbox[:1], client.inbox[5 : 5 + length]
                    client.inbox = client.inbox[5 + length :]
                    handle(kind, payload)

        if client and client in writable:
            try:
                sent = client.conn.send(client.outbox)
                client.outbox = client.outbox[sent:]
            except BlockingIOError:
                pass
            except OSError:
                drop_client()

        if exit_code is None:
            finished, status = os.waitpid(pid, os.WNOHANG)
            if finished:
                exit_code = os.waitstatus_to_exitcode(status)
                shell_open = False

        # Done: tell the API (if it's there) and leave.
        if exit_code is not None and not shell_open:
            send(b"x", str(exit_code).encode())
            deadline = time.monotonic() + 2
            while client and client.outbox and time.monotonic() < deadline:
                try:
                    client.conn.setblocking(True)
                    client.conn.settimeout(0.5)
                    sent = client.conn.send(client.outbox)
                    client.outbox = client.outbox[sent:]
                except OSError:
                    break
            break

        # Nobody attached for too long: end the shell.
        if not client and time.monotonic() - alone_since > ttl:
            try:
                os.kill(pid, signal.SIGHUP)
            except OSError:
                pass
            alone_since = time.monotonic()  # check again after another ttl

    drop_client()
    try:
        os.unlink(path)
    except OSError:
        pass
    os._exit(0)


def main():
    if sys.argv[1:2] == ["--serve"]:
        path, ttl, cols, rows = sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
        command = sys.argv[6:] or [os.environ.get("SHELL", "/bin/bash")]
        detached(path, ttl, cols, rows, command)
    else:
        cols, rows = int(sys.argv[1]), int(sys.argv[2])
        command = sys.argv[3:] or [os.environ.get("SHELL", "/bin/bash")]
        attached(cols, rows, command)


if __name__ == "__main__":
    main()
