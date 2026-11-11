# PracticePlan

Build, track and share sports practice schedules.

## Run it

Double-click **Start PracticePlan.bat**. The first run installs dependencies and builds the app, then opens
<http://localhost:4780> in your browser. Keep the console window open while you work. Close it to stop the app.

Requires Node.js 24 or newer. Automatic plan import also needs Claude Code installed and signed in on this computer.

## Accounts

The first time you open the app it asks you to create the administrator account. That account takes over the
teams and practices already in the data file. Everyone signs in with an email and password.

- **Adding people.** The administrator creates accounts on the Administration page and passes the starting
  password along. Each person must replace it at first sign-in.
- **Workspaces.** Each person has a workspace of their own: their teams, rosters, practices, drills and
  categories. Nobody can see another person's workspace.
- **Plan import** is off for new accounts. The administrator turns it on per person.
- **Self-service registration** with email confirmation is built but closed, because no email service is
  connected. `server/mailer.js` is where one plugs in. To try the flow on your own machine, start the server
  with `PP_MAIL_TRANSPORT=log`; confirmation links are then printed in the server console.
- **Forgotten password.** The administrator sets a new starting password on the Administration page.

## Your data

Everything lives in the `data` folder: the database `practiceplan.db` and the pictures in `uploads/`. Copy the whole folder to back it up.
Delete it to start over with the demo data.

## What is in the app

| Page | What it does |
| --- | --- |
| Dashboard | Time per category against targets, neglected categories, a practice timeline, most used items. |
| Practices | Build a schedule. Times cascade from the start time. Add breaks, groups, player notes. Duplicate or save as a template. |
| Import old plans | Upload a photo, PDF, Word or text plan and Claude drafts the practice and suggests new categories. You review before saving. Use it from the Practices page to create new practices, or from Import plan inside any practice to fill a shell you already made. |
| Homework | The same builder without clock times, with reps and optional per-player assignment. |
| Drill library | Reusable items. Adding one to a practice makes a copy. |
| Playbook | Diagram basketball plays step by step: players, defenders, ball, cuts, passes, dribbles and screens. Each new step starts where the last one ended. Plays have a category and tags, print on their own, and attach to practice items. |
| Resources | Every link, picture and video in one searchable place: the ones saved there directly, and the ones attached to drills, plays and practice items. Anything in the list can be attached elsewhere without uploading it again. |
| Categories | The tags (learning objectives) per sport, their colors, a default target percentage, and optional overrides for a single practice, a week, a month or the season. |
| Teams & rosters | One team per sport and season. Upload a roster from CSV or Excel. Link a GameChanger (or other iCalendar) schedule link to show games and practices on the dashboard timeline. |

The app follows your system's light or dark setting. The switch at the bottom of the sidebar forces one or the other.

Every plan has a **Print / share** view with three versions: Simple, With notes, and Coach copy.
Coach-only notes and player notes appear only in the Coach copy.

## Development

```
npm run dev      # API on :4780 with reload, Vite dev server on :5173
npm run build    # type-check and build the client into dist/
npm start        # serve the built app on :4780
```

Environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT`, `HOST` | Where the server listens. Defaults: 4780 and 127.0.0.1 (this computer only). |
| `PP_DATA_DIR` | Folder for the data file. Default `./data`. |
| `PP_SETUP_TOKEN` | Required to run first-time setup from anywhere but this computer. Set it on a hosted server. |
| `PP_SYSTEM_ADMIN` | Email address of the one system administrator account, which alone can open the System admin page and set upload space. Defaults to `fid.joe@gmail.com`. |
| `PP_TRUST_PROXY=1` | Set when the app sits behind a hosting provider's proxy. |
| `PP_COOKIE_SECURE=1` | Marks the sign-in cookie HTTPS-only. Set it whenever the site is served over HTTPS. |
| `PP_PUBLIC_URL` | The site's public address, used in confirmation emails. |
| `PP_MAIL_TRANSPORT=log` | Test mode for email: messages are printed in the console. |

The `Dockerfile` builds an image with the hosted defaults already set. Mount a persistent volume at `/data`.

## Layout

```
server/db.js      schema and the only code that talks to SQLite
server/seed.js    first-run demo data
server/index.js   REST API and static hosting
server/calendar.js  reads a team's schedule from a calendar subscription link
server/plays.js     the playbook; a play is a list of steps, each a drawing in court feet
server/images.js    pictures, videos and links attached to items, drills and plays
server/resources.js the Resources list: saved resources merged with everything attached elsewhere
server/ai.js        turns an uploaded plan into a draft, via Claude Code on this computer or a reply pasted from claude.ai
client/src        React app (pages/, components/, util.ts, api.ts)
```

## Where the hosted version stands

Done:

- Sign-in, sessions, password change, per-person workspaces, and an administrator page.
- Every API request is tied to the signed-in person's workspace. `server/auth.js` holds all of it.
- Registration with email confirmation, closed until an email service exists.

Not done yet:

- **Play builder for other sports.** Only the basketball court is drawn. `client/src/components/PlayDiagram.tsx`
  holds the court and `PLAY_CATEGORIES_BY_SPORT` in `util.ts` lists the supported sports; a new sport needs
  its field drawn there. The marks, lines and steps are sport-neutral.
- **Communities.** Planned, not started. The idea: people form communities (a school district, a group of
  coach friends, varsity coaches), a practice can be marked visible to a community, and members can read
  and discuss it. It needs shared teams and roles first, then: a `communities` table with members, a
  per-practice visibility setting, a read-only shared view that strips coach-only notes and player names on
  the server, and comment threads. Pictures on shared practices need their access check widened too, since
  today only the owning workspace can load them.
- **Picture and video storage.** Pictures and videos (up to 250 MB each) are files on the server's disk. Removing one from an item does not
  delete the file, because duplicated practices and library drills may still use it. A hosted version should
  move them to object storage and add cleanup of unused files.

- **Shared teams.** Staff, parents and players cannot be added to someone else's team yet. The `memberships`
  table is in place for it; roles and read-only viewer access are the next step.
- **Scheduled emails**, which also need the email service.
- **Database.** Still a single SQLite file. Fine for a small group on one server with a persistent disk.
  Move to Postgres in `server/db.js` before it grows.
- **Plan import on a hosted server.** Automatic import runs the `claude` program on the server's own machine,
  which a hosted container does not have. The paste-from-claude.ai route works anywhere.
- **Calendar links.** The server fetches whatever link a coach pastes. Block private and internal addresses
  before opening signup to strangers.
- **Notes HTML** is sanitized in the browser before display. Sanitize on the server too.
- **Sign-in throttling** is kept in memory and resets on restart.
