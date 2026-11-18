import { useState } from 'react';
import { Link } from 'react-router-dom';
import { roomyScreen } from '../util';
import PageTitle from '../components/PageTitle';

interface Topic {
  group: string;
  title: string;
  steps: string[];
  /** Something worth knowing once the steps are done. */
  tip?: string;
  /** Where in the app this happens, as a link and its words. */
  go?: [string, string];
  /** Other words people might search with. */
  words?: string;
}

const TOPICS: Topic[] = [
  // --- Getting started ---
  {
    group: 'Getting started',
    title: 'Set up your team and roster',
    steps: [
      'Open "Team & roster" in the menu.',
      'On "Team info & roster", fill in the team name and season.',
      'Press "Add player" for each player, or "Upload roster (CSV or Excel)" to bring in a whole list at once.',
    ],
    tip: 'To add another team, press "Switch team" at the top of the menu, then "+ New team".',
    go: ['/teams', 'Team & roster'],
    words: 'players kids names numbers spreadsheet new team create',
  },
  {
    group: 'Getting started',
    title: 'The three steps to your first practice',
    steps: [
      'Build a few reusable drills on the Drills page.',
      'Create a practice and add your drills to it, along with anything else such as breaks or custom items.',
      'Refine it: attach plays, tag items with categories to see where the time goes, and share it with other coaches.',
    ],
    tip: '"Take the tour" in the menu under your name walks through this on screen.',
    words: 'begin start new first how tutorial tour',
  },
  // --- Drills ---
  {
    group: 'Drills',
    title: 'Create a drill',
    steps: ['Open "Drills" in the menu.', 'Press "+ New drill".', 'Give it a name, how long it takes, its categories and notes. Add pictures, videos, links or plays if you have them.', 'Save. The drill is now ready to drop into any practice.'],
    tip: 'A custom item you wrote inside a practice can become a drill too: open the item and press "Save to drill library".',
    go: ['/library', 'Drills'],
    words: 'library add reusable exercise',
  },
  {
    group: 'Drills',
    title: 'Bring in drills you already have (spreadsheet, Word, notes)',
    steps: [
      'Open "Drills" and press "Import".',
      'Either upload a spreadsheet, or follow the instructions there to have your own AI assistant turn your documents into the format Dime Coach reads.',
      'Review the list before anything is saved. Drills whose names clash with ones you already have are flagged for you to decide.',
    ],
    tip: 'Importing never changes or deletes the drills you already have.',
    go: ['/library', 'Drills'],
    words: 'excel csv upload bulk markdown chatgpt claude existing',
  },
  {
    group: 'Drills',
    title: 'Get drills from other coaches',
    steps: ['Open "Coach library" for drills and packs published for everyone, and press "Add to mine" (or "Add all to mine" for a pack).', 'Or, in a community you belong to, open something a coach shared and press "Add to mine".'],
    tip: 'What you add is your own copy. Changing it does not change the original.',
    go: ['/coach-library', 'Coach library'],
    words: 'download copy packs shared find search',
  },
  {
    group: 'Drills',
    title: 'Set up categories to track where practice time goes',
    steps: ['Open "Categories" in the menu and add the ones you care about, such as Shooting or Defense.', 'Tag each drill with its categories when you create or edit it.', 'In a practice, press the "At a glance" button on the schedule to see minutes by category.'],
    go: ['/tags', 'Categories'],
    words: 'tags tagging progress balance chart bars minutes',
  },
  // --- Practices ---
  {
    group: 'Practices',
    title: 'Create a practice',
    steps: ['Open "Practices & games" and press "+ New practice".', 'Set the date, start time and location at the top.', 'Press "+ Item" and pick "Choose a drill", "Custom item" or "From a community". On a wide screen you can also drag drills in from the list on the left.', 'Set how long each item runs. Each one starts when the one before it ends.'],
    tip: 'Changes save on their own as you go.',
    go: ['/practices', 'Practices & games'],
    words: 'plan schedule new build add items break',
  },
  {
    group: 'Practices',
    title: 'Reuse an earlier practice or a template',
    steps: ['Open a new, empty practice.', 'Press "Start from a previous practice".', 'Hover over a line (or press "View practice" on a phone) to see what is in it, then choose it. Its items are copied in for you to adjust.'],
    tip: 'To keep a practice as a starting point for later, open its "…" menu and choose "Save as template". "Duplicate" makes a straight copy.',
    words: 'copy repeat duplicate template again last week',
  },
  {
    group: 'Practices',
    title: 'Print a practice, or give it to players and parents',
    steps: ['Open the practice.', 'Press "Print" on the schedule.', 'Choose what to include, then print it, save it as a PDF, or copy it into an email.'],
    words: 'pdf paper handout export email parents',
  },
  {
    group: 'Practices',
    title: 'See the whole season',
    steps: ['Open "Practices & games".', 'The list shows every practice, game and event in date order, opening on what is next. Use "Jump to a month…" to move around, or switch to the calendar view.', 'On the calendar, hover over anything to see a summary.'],
    go: ['/practices', 'Practices & games'],
    words: 'calendar list month schedule upcoming view',
  },
  {
    group: 'Practices',
    title: 'Pull games and practices in from your team calendar',
    steps: ['Open "Team & roster" and go to "Schedule integration".', 'Paste the calendar link from your scheduling app and save.', 'Events from that calendar now appear on your schedule, ready to be planned.'],
    go: ['/teams', 'Team & roster'],
    words: 'gamechanger teamsnap ical sync link import schedule',
  },
  {
    group: 'Practices',
    title: 'Give players homework',
    steps: ['Open "Homework" in the menu.', 'Create a sheet and add items the same way as a practice.', 'Print or share it for players to take home.'],
    go: ['/homework', 'Homework'],
    words: 'at home sheet assignments',
  },
  // --- Games ---
  {
    group: 'Games',
    title: 'Plan a game',
    steps: ['Open the event from "Practices & games", or create a new one.', 'Switch "Practice" to "Game" at the top.', 'Fill in the opponent, home or away, and when to arrive. Mark who is here.', 'In "Lineup and playing time", set who is in for each stretch and which position they play. The charts beside it show each player\'s time.'],
    tip: 'Switching between Practice and Game never loses anything: both are kept.',
    words: 'lineup substitutions subs playing time minutes opponent bench rotation',
  },
  {
    group: 'Games',
    title: 'Change what positions are called',
    steps: ['Open a game.', 'In "Lineup and playing time", press "Change what they are called".', 'Type your own names separated by commas, such as 1, 2, 3, 4, 5, and save.'],
    tip: 'The names are kept for the team, so every game uses them.',
    words: 'pg sg point guard numbers rename',
  },
  {
    group: 'Games',
    title: 'Print a bench card with substitutions',
    steps: ['Open the game and press "Print".', 'Turn on "Substitutions" to list who comes out, who goes in and who moves position at each change.', 'Print it.'],
    words: 'subs sheet card paper who goes in out',
  },
  // --- Plays ---
  {
    group: 'Plays',
    title: 'Draw a play',
    steps: ['Open "Playbook" and press "+ New play".', 'Place players and the ball on the court, then draw cuts, passes, dribbles and screens.', 'Add steps to show how the play develops, and play it back.'],
    tip: 'Attach a play to a drill or a practice item so it is right there on the day.',
    go: ['/playbook', 'Playbook'],
    words: 'diagram court whiteboard animation steps x o',
  },
  // --- Working with other coaches ---
  {
    group: 'Working with other coaches',
    title: 'Share a team with an assistant coach',
    steps: ['Open "Team & roster" and go to "Coaches & helpers".', 'Add the coach by their email address.', 'Choose what they may change: practices, drills, plays, resources.'],
    tip: 'Someone without a Dime Coach account is emailed an invitation, and joins the team once they have created one. Until then they are listed as "Invited", where you can send the invitation again or cancel it.',
    go: ['/teams', 'Team & roster'],
    words: 'invite helper staff permissions access collaborate add coach',
  },
  {
    group: 'Working with other coaches',
    title: 'Discuss a practice or game with your coaches',
    steps: ['Open the practice or game.', 'Write in the "Discussion" box and post. Reply to any post to keep a thread together.', 'Type @ and a name to get one coach\'s attention.'],
    tip: 'Everyone the team is shared with gets a message when you post. You can edit your own posts afterwards.',
    words: 'comments chat talk mention reply thread notes',
  },
  {
    group: 'Working with other coaches',
    title: 'Join or start a community',
    steps: ['Open "Communities".', 'To join one, type the code you were given at the top and press "Join".', 'To start one, press "+ New community", name it, and give its code to the coaches you want in it.'],
    go: ['/communities', 'Communities'],
    words: 'group code league division club invite',
  },
  {
    group: 'Working with other coaches',
    title: 'Send a practice to another coach',
    steps: [
      'Open the practice and press the share button beside "Print".',
      'Under "Coaches", pick coaches on your team or in your communities, or type email addresses, add a note if you like, and press Send.',
      'Each coach gets an email with the outline and a link to read it. A coach who uses Dime Coach can add a copy to their own practices.',
      'Or under "Link", make a link anyone can open, to paste into a text message or a group chat.',
      'Your coach-only notes, player notes and uploaded files are never included. "Stop sharing" turns a link off.',
    ],
    words: 'email link text assistant forward give share send',
  },
  {
    group: 'Working with other coaches',
    title: 'Share a drill, play or practice with a community',
    steps: ['In the community, start a post and attach a drill, play or plan to it.', 'Or start from the thing itself: the share button on a drill or a practice, then "Communities".', 'Other members can open it and press "Add to mine" to take a copy.'],
    words: 'post attach send give publish',
  },
  {
    group: 'Working with other coaches',
    title: 'Keep up with messages',
    steps: ['A dot on "Messages" in the menu means something new has arrived. It shows up within a moment, with no need to refresh.', 'Open "Messages" to read replies, mentions, shares and discussion posts.', 'Press a message to go to what it is about.'],
    go: ['/messages', 'Messages'],
    words: 'notifications inbox alerts unread new',
  },
  // --- Your account ---
  {
    group: 'Your account',
    title: 'Change your password or your details',
    steps: ['Press your name at the bottom of the menu.', 'Choose "Account".', 'Change your details or your password there.'],
    go: ['/account', 'Account'],
    words: 'email name profile sign in login',
  },
  {
    group: 'Organizations',
    title: 'Run a club or sports program as an organization',
    steps: [
      'Start a community under Communities, and ask the Dime Coach administrator to put it on the organization plan with the number of coach seats you need.',
      'Open the community and switch to "Manage". The overview lists what needs your attention, each with the way to fix it.',
      'Under "Coaches", invite your coaches by email. Each coach or assistant uses one seat.',
      'Under "Seasons & teams", start a season, add a division for each sport and age group, and add its teams. The selectors at the top jump between seasons, divisions and teams.',
      'Use "Assign a coach" on each team, then "Build the schedule" on the division.',
      '"Schedule" shows every game in one list. Under "More" are announcements, fields and gyms, usage, the activity log and settings.',
    ],
    tip: 'The organization owns its teams, so a team and its roster stay when a coach moves on. What the coach wrote is copied to their own account at that moment.',
    words: 'organization club league division office enterprise seats quota coaches teams schedule season announcement admin',
  },
  {
    group: 'Organizations',
    title: 'Sign players up and put them on teams',
    steps: [
      'In the organization, switch to "Manage" and open "Players". Choose the season at the top.',
      'Under "Sign-up form", open sign-ups and send the link to parents. Each player they sign up lands in the list. You can also add players yourself, one at a time or by pasting a list of names.',
      'Under "Put on teams", choose a division. Drag a player to a team, or use the "…" beside them to put them on a team, move them, or take them off.',
      '"Place automatically" deals the waiting players out evenly. Set the ideal number of players on a team, look at what it would do, then place them.',
      'Players you placed by hand are marked "by hand" and are never moved by automatic placing. "Undo automatic placing" sends only the automatic ones back to waiting.',
    ],
    tip: "A player on a team is on that team's roster, where its coach sees them. Parents' contact details are shown only to admins who may see rosters.",
    words: 'signup sign-up register registration players kids roster seed place teams automatic division waiting form parents',
  },
  {
    group: 'Organizations',
    title: 'Coach a team that belongs to an organization',
    steps: [
      'Use "Switch team" and choose the team under "Shared with you". It says which organization it is from.',
      'Plan practices as usual. Division games set by the organization are already in "Practices & games", marked "Division game".',
      'Drills and plays are shared by every team in the organization: you can use all of them and change the ones you added.',
    ],
    tip: 'If you are taken off the team or leave, your drills, plays and practices are copied to your own account. The roster stays with the organization.',
    words: 'organization coach assigned league division game shared drills keep copy leave moved',
  },
  {
    group: 'Organizations',
    title: 'Give parents a public schedule',
    steps: ['In the organization, switch to "Manage", open "More", then "Public schedule".', 'Under "Public schedule page", choose a web address and your color, and save.', 'Turn on "Show the page to anyone with the link", then share the link.'],
    tip: 'The page shows teams, game times, results and standings. It never shows coaches, rosters or players. Each team has a calendar link parents can subscribe to.',
    words: 'public page parents schedule standings results calendar feed subscribe link website',
  },
  {
    group: 'Your account',
    title: 'Get back in when you forget your password',
    steps: ['On the sign-in page, press "Forgot your password?".', 'Enter the email you sign in with.', 'Open the link in the email and choose a new password. You are signed in straight away.'],
    tip: 'The link works once, for an hour. Choosing a new password signs you out on every other device.',
    words: 'forgot forgotten reset lost locked out recover email link',
  },
  {
    group: 'Your account',
    title: 'Switch between light and dark',
    steps: ['Press your name at the bottom of the menu.', 'Use the "Appearance" switch.'],
    words: 'theme mode color night',
  },
  {
    group: 'Your account',
    title: 'Use Dime Coach on a phone',
    steps: ['Open the same address in your phone\'s browser and sign in.', 'Use the menu button at the top to move around.', 'Long lists show a short line for each thing, with a button to see the rest.'],
    words: 'mobile tablet ipad small screen app',
  },
];

const GROUPS = [...new Set(TOPICS.map((t) => t.group))];

/** Answers to "how do I…", grouped by what you are trying to do, with a search box over all of it. */
export default function Help() {
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = TOPICS.filter((t) => {
    const hay = `${t.group} ${t.title} ${t.steps.join(' ')} ${t.tip ?? ''} ${t.words ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return (
    <div className="page help">
      <div className="page-head">
        <div>
          <PageTitle>Help</PageTitle>
          <p className="muted">How to do the common things in Dime Coach, step by step.</p>
        </div>
      </div>
      <input className="input help-search" type="search" autoFocus={roomyScreen()} aria-label="Search help" placeholder="Search help, such as “print” or “roster”" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 ? (
        <div className="empty">
          <h2>Nothing matches “{q.trim()}”</h2>
          <p>Try a shorter or different word, or clear the search to see everything.</p>
        </div>
      ) : (
        GROUPS.filter((g) => shown.some((t) => t.group === g)).map((g) => (
          <section key={g} className="help-group">
            <h2>{g}</h2>
            {shown
              .filter((t) => t.group === g)
              .map((t) => (
                // While searching, what matched is open already.
                <details key={t.title} className="help-topic" open={words.length > 0 && shown.length <= 4 ? true : undefined}>
                  <summary>{t.title}</summary>
                  <ol>
                    {t.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                  {t.tip && <p className="help-tip">{t.tip}</p>}
                  {t.go && (
                    <Link className="btn small" to={t.go[0]}>
                      Go to {t.go[1]}
                    </Link>
                  )}
                </details>
              ))}
          </section>
        ))
      )}
    </div>
  );
}
