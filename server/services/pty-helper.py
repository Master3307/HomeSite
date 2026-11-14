#!/usr/bin/env python3
"""
A real terminal (pty) for the /hub console, without native Node modules.

Started by server/services/hubTerminal.cjs:
    python3 pty-helper.py <cols> <rows> <shell> [args...]

stdin  -> keystrokes for the shell
stdout <- everything the shell prints
fd 3   -> control lines: "<cols> <rows>\n" resizes the terminal

Exits with the shell's exit code.
"""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    cols, rows = int(sys.argv[1]), int(sys.argv[2])
    command = sys.argv[3:] or [os.environ.get("SHELL", "/bin/bash")]

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
                while data:
                    written = os.write(fd, data)
                    data = data[written:]

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


if __name__ == "__main__":
    main()
