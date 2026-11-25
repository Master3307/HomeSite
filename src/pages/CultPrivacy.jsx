import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'

import OriginShell from '/src/components/OriginShell.jsx'
import { siteConfig } from '/src/lib/siteConfig'

/*
 * /privacy: what is stored, why, who sees it, how to delete it. It wears the
 * look of where it was opened from (components/OriginShell.jsx).
 * Keep it in sync with what the code does (server/services/members.cjs,
 * memberData.cjs, privacy.cjs, discordOAuth.cjs, backup.cjs).
 */

function Block({ icon, title, id, children }) {
  return (
    <section className="privacy-block" id={id}>
      <h2>
        <span className="material-symbols-outlined" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function years(days) {
  if (!days) return null
  if (days % 365 === 0) return `${days / 365} ${days === 365 ? 'year' : 'years'}`
  return `${days} days`
}

export default function CultPrivacy() {
  const { t } = useTranslation('title')
  const name = siteConfig.privacyName
  const email = siteConfig.privacyEmail
  const inactive = years(siteConfig.inactiveDays)

  return (
    <OriginShell storeKey="homesite:privacy:from" title="Privacy" heading={t('privacy', { ns: 'title', defaultValue: 'Privacy of HomeSite' })} backLabel="Back">
      <article className="privacy">
        <header className="privacy-hero">
          <span className="material-symbols-outlined" aria-hidden="true">
            shield_person
          </span>
          <div>
            <h1>Your data, plainly explained</h1>
            <p>
              This is a small community site. We keep only what the site needs to work, never sell anything and show no ads. Here is everything, in plain
              words.
            </p>
          </div>
        </header>

        <div className="privacy-tldr">
          <p>
            <strong>In short:</strong> logging in with Discord gives us your Discord name, ID and picture. What you do here (votes, pets, taps, your
            profile) is saved so the site can show it. You choose whether your profile is public. You can delete everything yourself, any time, and it's
            gone at once.
          </p>
        </div>

        <Block icon="badge" title="Who is responsible">
          <p>
            {name || 'The owner of this site'} runs this site and is responsible for your data.
            {email && (
              <>
                {' '}
                Questions, a copy of your data, or anything else: write to <a href={`mailto:${email}`}>{email}</a>.
              </>
            )}
          </p>
        </Block>

        <Block icon="login" title="Logging in">
          <p>
            You log in with Discord. Anyone can make an account; what belongs to our Discord server (voting, birthdays, member profiles and the
            member list) is only for people who are in it. Discord tells us your <strong>user ID, username, display
            name and profile picture</strong> (nothing else: not your email, not your messages, not your friends). We keep a copy of your picture so the
            site loads fast.
          </p>
          <p>
            A login cookie keeps you logged in. It only holds a random key; we store just a scrambled version of it. If you log in with your email and tick
            "Trust this browser", a second cookie lets that browser skip the extra step for 30 days (it is signed and stops working when your password or
            second step changes). No other cookies.
          </p>
          <p>
            <strong>The apps</strong> (HomeSite App and CultSite App) are this website in an app: they store and send exactly the same, and each keeps its
            own login cookie inside the app. Logging in with Discord opens your browser for that one step and hands a one-time code back to the app, which
            is only good for two minutes and only for the app that asked for it.
          </p>
        </Block>

        <Block icon="inventory_2" title="What we keep about you">
          <ul className="privacy-list">
            <li>
              <strong>Your account:</strong> the Discord details above, when you joined and last logged in, the last time you were seen in the server, and whether you're in our Discord server right now.
              Anyone can have an account; voting, birthdays, member profiles and the member list, the lobby cat's progress and reporting are only for people in
              the server, so whether you are is checked with Discord (when you log in, while you use those parts, and once a day). Leaving takes those parts away again;
              your account and dash stay.
            </li>
            <li>
              <strong>Your settings:</strong> theme, language, clock, time zone, colour, animations, your own CSS and whether pages should open in the
              app on Android, so they follow you to other devices.
            </li>
            <li>
              <strong>Your profile:</strong> public or private, your bongo avatar, the picture or GIF you upload for it, and your saved looks.
            </li>
            <li>
              <strong>Your avatar,</strong> if you choose your own instead of the Discord one (Settings → Account): only the round part you picked, made
              smaller and saved again, which drops everything hidden in the file (camera, place, date). It's shown wherever your Discord picture would be.
              &quot;Back to the Discord picture&quot; deletes it right away; a copy of your Discord picture is kept for that.
            </li>
            <li>
              <strong>Your email,</strong> only if you add it. It's only for news about your account or the site, and never shown to anyone.
            </li>
            <li>
              <strong>Notifications:</strong> your newest 200 notifications on the site. Emails are only sent for what you turned on in Settings, to
              your verified email, in your language and look (with your own CSS, if you set one). Every one has a link to stop them. Security emails
              (a new login with your email, a changed password or second step) are always sent, so you notice if it wasn't you.
            </li>
            <li>
              <strong>Push notifications,</strong> only on the devices where you turn them on (in Settings). For each one we keep its push address (a
              random token from your browser's push service or, in the app, from Google's Firebase), a short name like “Chrome · Android”, and when it
              was added and last used. The notification itself goes through that push service (Google, Mozilla, Apple …) to your device. Turning push
              off or logging out on that device removes it here; a device the push service no longer knows is removed by itself.
            </li>
            <li>
              <strong>About you, if you add it:</strong> hobbies and gender (from the server's onboarding questions, which move here once you have an
              account), your birthday (shared with the bot's /birthday; the year is optional and never shown) and your birthday dress code (only on your celebration day, deleted the day after), and whose
              birthdays the bot should remind you of.
            </li>
            <li>
              <strong>Fun stuff:</strong> lobby cat pets and taps (in total and per day), its trust in you, your FDC votes, favourite items, cat
              designs you suggested for the recycling bin (with your name, so the editors know who sent them).
            </li>
            <li>
              <strong>Your dash</strong> (<Link to="/dash">/dash</Link>), when you're logged in: its look, pages, widgets and what you put in them
              (links, notes, to-dos, places for the weather, feeds and repositories you follow), so it's the same on every device. Feeds are fetched
              for you by our server, because most feeds can't be read straight from a browser; it only sends their address, keeps the answer 10
              minutes in memory (shared by everyone reading the same feed) and never writes down who asked. Weather, prices, Hacker News, releases
              and favicons are loaded by your browser straight from those services (searching for a coin sends what you type to CoinGecko). A Discord status widget showing your own status reads it from our bot, like your profile page does; nothing new is stored. Your recent searches in the dash's search bar stay in your
              browser only (never sent to us; turn them off or clear them there). If you speak a search, your browser's speech recognition hears it (Chrome and Edge send the audio to Google or Microsoft for that; we never get it). Looking up a Minecraft player sends the name you typed to playerdb.co and loads the face from crafthead.net (or mc-heads.net / minotar.net). A picture you add to the search stays in your browser: its text is read there (the reading models load once from jsDelivr), and it only goes to Google Lens, Bing or TinEye if you click one of them. Translations go to the translation service on our own server and are not kept. The calculator works in your browser too; if you divide by zero,
              it opens the Wikipedia page about that kind of mistake (only which kind, never what you typed).
            </li>
            <li>
              <strong>What your dash keeps is only used to show your dash.</strong> It isn't read, analysed or shared for anything else. Wallpapers,
              fonts and pictures you upload are stored on our server under long random addresses (anyone with such an address can load the file, nobody
              can list them); pictures are made again when uploaded, which drops everything hidden in them (camera, place, date). Together with uploaded
              songs they count against your storage. In <Link to="/settings/account">Settings → Account</Link>, “Wipe my dash” deletes all of it at once:
              layout, widgets, integrations, calendars, contacts, music and files. Your account stays.
            </li>
            <li>
              <strong>The search bar's tools</strong> (type “help” in the dash search): encodings, hashes, passwords, QR codes, ages, dates and numbers are
              worked out in your browser and never sent anywhere; the password generator's options and the colours you keep stay in your browser.
              A few tools ask a service, straight from your browser and only when you use them: <em>my IP</em> and <em>my location</em> ask ipwho.is
              (which sees your IP address, that is the point), <em>weather</em> asks Open-Meteo for the place (and Photon / OpenStreetMap to find a typed
              place), currencies ask Coinbase for the rates (or the ECB through frankfurter.dev); only the currency codes go there, never the amount.
              Your exact location is only used if you allow it in your browser; it stays on your device apart from going to the weather or map service you asked.
              A link you paste gets a preview from our server: it fetches that page (without cookies), and checks the link's host name against Cloudflare's
              and Quad9's lists of dangerous sites. The answer is kept 30 minutes in memory, shared by everyone, and nobody writes down who asked.
              Website icons on the dash come from the service chosen in its settings (DuckDuckGo by default, which only sees the site names).
            </li>
            <li>
              <strong>Dash integrations,</strong> only if you add some: the address of each of your services (like your Navidrome, Jellyfin or
              Home Assistant), a name, a user name if it needs one, and its password, token or key. Those secrets are encrypted on our server and never
              sent back to any browser, not even yours; our server uses them to ask your service for what your widgets show, and keeps the answers a
              few seconds in memory. Files you open or upload in a files widget (WebDAV, Nextcloud, copyparty) pass through our server on their way
              and are never kept there. Removing an integration deletes it right away.
            </li>
            <li>
              <strong>Your calendars</strong> (the calendar widget on /dash), only if you use them: the calendars you make or import and their events (title,
              time, place, notes, link, how they repeat), and for a calendar you subscribe to, its address (encrypted on our server, like an integration's
              secret, since whoever has it can read that calendar; only its host name is shown back) and a copy of its events, fetched again at most every half
              hour while you look at it. Deleting a calendar deletes its events right away.
            </li>
            <li>
              <strong>Your contacts</strong> (the contacts widget on /dash), only if you use it: the people you add or import from a .vcf file, with what you
              give them (name, nickname, company, phone numbers, email and postal addresses, websites, birthday, notes, a small photo, which member of our
              server they are). They're only ever shown to you; .vcf files are read and written in your browser. Deleting a contact deletes it right away.
            </li>
            <li>
              <strong>Pictures for a slideshow</strong> you upload are stored like wallpapers (see above). An Immich album is read through that integration.
            </li>
            <li>
              <strong>Your music library</strong> (the music widget on /dash), only if you use it: songs you upload (stored on our server, up to your space,
              until you remove them or delete your account), links and YouTube videos you add, songs from your own Navidrome or file integrations (their files pass
              through our server while they play and are kept a few minutes in memory for seeking), titles you edit, your playlists, and which of your devices is
              playing right now (in memory only, so only one plays at a time). What plays, the queue and the volume stay in your browser.
            </li>
            <li>
              <strong>Master Search (/search):</strong> what you search for goes to our server and from there to this site's own SearXNG, which asks
              several search engines for you; they see our server, not you. Searches aren't saved with your name or account; the same search is answered
              from memory for 10 minutes. Safe search is strict unless you choose otherwise in its preferences (kept in this browser and, when you're
              logged in, with your settings). Pictures and website icons in the results load straight from those sites and DuckDuckGo's icon service.
              When SearXNG has nothing and you're logged in, the search can go on to Brave Search (from our server, without your name); the server only
              counts how many such searches were made this month. Logged in, the same words are also looked up in your own things: this browser's copy of
              your dash bookmarks and your contacts, and, through our server, the services you connected (music, photos, films, documents, devices,
              files). Those answers come back only to you and aren't kept.
            </li>
            <li>
              <strong>The setup on /card:</strong> its "Network" page shows you your own IP address and roughly where it is (city,
              region, country, time zone), as Cloudflare passes it along with your visit. It is shown only to you and never saved.
            </li>
            <li>
              <strong>For the FDC editors:</strong> a log of the migration (who designed, suggested, approved or turned down which cat, and when),
              and a stats page with everyone's taps and pets. If your profile is set to “Only me”, you're counted there but your name isn't shown.
              Deleting your account takes your name out of the log; the counts stay without it.
            </li>
            <li>
              <strong>On the Discord server, the bot keeps:</strong> your level and points (it counts messages, it doesn't save what you write), pets given
              and received, achievements, your birthday if you set one, and lobby codes you posted.
            </li>
            <li>
              <strong>For the admin:</strong> a log of actions on the website (like logins and edits), and for 7 days a list of status and activity
              changes in the server, to keep an eye on things.
            </li>
          </ul>
          <p className="privacy-note">
            Your Discord status, games, music, roles and when you joined are shown on your profile live, straight from Discord. We don't store them.
          </p>
        </Block>

        <Block icon="visibility" title="Who sees what">
          <ul className="privacy-list">
            <li>
              <strong>Members</strong> (the default): only logged-in members who are in the server can see your profile, and they find you in the
              member list.
            </li>
            <li>
              <strong>Everyone:</strong> anyone with the link can see your profile, also people without an account.
            </li>
            <li>
              <strong>Only me:</strong> nobody else can see it, not even members. You're not in the member list, and the website never shows you as
              online. You still count in the total number of members, which doesn't say who anyone is.
            </li>
            <li>The FDC poll shows who voted to people who are logged in.</li>
            <li>Your birthday (day and month) and hobbies show on your profile and the birthday list, to the same people who may see your profile. Without an account here, logged-in members see your name, avatar and birthday on the list (the same as /birthday shows on Discord).</li>
            <li>Your email, settings and saved looks are only for you.</li>
          </ul>
          <p>
            Change it any time in <Link to="/settings/account">Settings</Link>.
          </p>
        </Block>

        <Block icon="flag" title="Reports">
          <p>
            Logged-in members can report a member. A report goes to the server's moderators with what it's about and a short note. You can send it
            anonymously: then the moderators don't see who sent it, and we don't store it with your account either.
          </p>
          <p>
            Reports wait for a moderator to look at them, on the site or in the server. Moderators can warn, limit (no profile changes for a while),
            remove a bongo avatar or picture, ban someone from logging in, or (only the owners) delete an account. The person always gets told why.
          </p>
          <p>
            <strong>Reports and moderation records are kept,</strong> also when the person deletes their account. Otherwise someone could dodge a report,
            a warning or a ban by deleting and coming back.
          </p>
        </Block>

        <Block icon="delete_forever" title="Deleting your account" id="deleting">
          <p>
            In <Link to="/settings/account">Settings</Link>, “Delete my account” removes <strong>everything</strong> about you, right away:
          </p>
          <ul className="privacy-list">
            <li>your account, profile, avatar, pictures, settings (your dash too), email, saved looks, push devices, dash integrations, calendars and contacts,</li>
            <li>your levels, points, pets, taps, achievements and birthday,</li>
            <li>messages from our bot that mention you,</li>
            <li>everything about you in the activity log,</li>
            <li>personal things this browser kept (like the lobby cat's memory of you). Your theme and language stay.</li>
          </ul>
          <p>A few things stay, on purpose:</p>
          <ul className="privacy-list">
            <li>
              <strong>One line in the activity log</strong> saying that your display name deleted their account, and when. Nothing else from before.
            </li>
            <li>
              <strong>Your FDC votes still count,</strong> but without your name: nobody can tell they were yours.
            </li>
            <li>
              <strong>Reports and moderation records</strong> about your account (see above). Reports you sent stay too, but without your name.
            </li>
          </ul>
          <p>
            For 13 days after deleting, our own tools can't look you up at all, not even the admin's. After that the account is simply gone. Restoring an
            old backup never brings it back.
          </p>
          {inactive && (
            <p>
              <strong>Accounts nobody uses:</strong> if you're not in the server and haven't used the site while logged in for {inactive}, your account and
              data are deleted the same way. Members of the server are never removed by this.
            </p>
          )}
          <p>You can log in again later; you start from zero, like the first time.</p>
        </Block>

        <Block icon="cloud" title="Where it lives">
          <p>
            Everything is on our own server. Backups are encrypted and kept by the owner. Server logs are rotated and deleted after a while. There are no
            ads and no trackers of our own; pictures from Discord come from Discord.
          </p>
        </Block>

        <Block icon="query_stats" title="Cloudflare and its page statistics" id="analytics">
          <p>
            The site reaches you through <strong>Cloudflare</strong> (a tunnel that keeps our server safe). Like every network on the way, Cloudflare
            sees your IP address and which pages you open while passing them on.
          </p>
          <p>
            Cloudflare also adds <strong>Cloudflare Web Analytics</strong> to the pages: anonymous statistics such as how many people visit, how fast
            pages load, which country and browser. It sets no cookies and builds no profile of you, but it does send a small report to Cloudflare.
          </p>
          <p>
            <strong>Don't want that?</strong> Turn on “Block Cloudflare analytics” in <Link to="/settings">Settings</Link>. Then the statistics script
            is stopped and nothing is sent, also when you're not logged in (the choice is saved in your browser).
          </p>
        </Block>

        <p className="privacy-updated">Questions? {email ? <a href={`mailto:${email}`}>{email}</a> : 'Ask the server owner.'}</p>
      </article>
    </OriginShell>
  )
}
