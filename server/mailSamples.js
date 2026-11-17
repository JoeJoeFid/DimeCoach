// One example of each kind of email Dime Coach sends, for the system administrator to look at
// and send to themselves. The words follow the real messages; the names and links are made up.
const DAYS = 14;
export const MAIL_SAMPLES = [
  {
    id: 'invite', label: 'Invitation to Dime Coach, with your own message',
    make: ({ me, base }) => ({
      subject: `${me.name} invited you to Dime Coach`,
      text:
        `Hi Casey,\n\n${me.name} invited you to Dime Coach, where coaches plan practices, keep drills and draw plays.\n\n` +
        `${me.name} wrote:\nWelcome aboard. Start by making your team, then have a look in the coach library.\n\n` +
        `Choose a password to finish setting up your account:\n\n${base}/welcome?token=sample\n\n` +
        `The link works for ${DAYS} days. If you were not expecting this, ignore this message and nothing will happen.`,
    }),
  },
  {
    id: 'team', label: 'Invitation to help coach a team',
    make: ({ me, base }) => ({
      subject: `${me.name} invited you to Tigers on Dime Coach`,
      text:
        `Hi,\n\n${me.name} invited you to join the team "Tigers" (Basketball, Winter 2026-27) on Dime Coach as Assistant coach.\n\n` +
        `Dime Coach is where coaches plan practices, keep drills and draw plays together.\n\n` +
        `Create your account to join the team:\n\n${base}/join?token=sample\n\n` +
        `The link works for ${DAYS} days. If you were not expecting this, ignore this message and nothing will happen.`,
    }),
  },
  {
    id: 'practice', label: 'A practice sent to another coach',
    make: ({ me, base }) => ({
      subject: `${me.name} sent you a practice plan: Thursday practice`,
      text:
        `Hi Casey,\n\n${me.name} sent you a practice plan on Dime Coach: "Thursday practice", for Tigers, Thursday, November 19.\n\n` +
        `${me.name} wrote:\nTry the shell drill before scrimmage. It settled our help defense.\n\n` +
        `4 items, 62 minutes:\n- Dynamic warm-up (10 min)\n- Layup lines (12 min)\n- Shell drill (15 min)\n- 5-on-5 half court (20 min)\n\n` +
        `Open it here:\n\n${base}/shared/sample`,
    }),
  },
  {
    id: 'organization', label: 'Invitation to coach in an organization',
    make: ({ me, base }) => ({
      subject: `${me.name} invited you to Eastside Youth on Dime Coach`,
      text:
        `Hi Casey,\n\n${me.name} invited you to Eastside Youth on Dime Coach as Head coach of Tigers.\n\n` +
        `Dime Coach is where Eastside Youth's coaches plan practices, keep drills and draw plays together.\n\n` +
        `Create your account to join:\n\n${base}/join?token=sample\n\n` +
        `The link works for ${DAYS} days. If you were not expecting this, ignore this message and nothing will happen.`,
    }),
  },
  {
    id: 'announcement', label: 'An announcement from an organization',
    make: ({ me, base }) => ({
      subject: 'Eastside Youth: Winter leagues start December 7',
      text:
        `Hi Casey,\n\n${me.name} sent this to all basketball coaches of Eastside Youth.\n\n` +
        `Coach check-in is at 8:30 AM. Please bring your roster and any questions for the season.\n\n` +
        `Read it in Dime Coach:\n\n${base}/communities/1?tab=announcements`,
    }),
  },
  {
    id: 'family', label: 'A parent, relative or friend added to a team',
    make: ({ me }) => ({
      subject: `${me.name} added you to Tigers on Dime Coach`,
      text:
        `Hi Pat,\n\n${me.name} added you to the parents, family and friends of Tigers, as a parent of Jordan Smith.\n\n` +
        `${me.name} wrote:\nGlad to have you with us this season.\n\n` +
        `Dime Coach is where the coaches of Tigers plan practices and games. Being on this list means they can send you practice plans, schedules and news at this address. You do not need an account.\n\n` +
        `If you would rather not be on the list, write to ${me.name} at ${me.email}.`,
    }),
  },
  {
    id: 'confirm', label: 'Confirm a new account',
    make: ({ base }) => ({
      subject: 'Confirm your Dime Coach account',
      text: `Hi Casey,\n\nConfirm your email address to finish creating your Dime Coach account:\n\n${base}/confirm?token=sample\n\nThe link works for 24 hours. If you did not ask for an account, ignore this message.`,
    }),
  },
  {
    id: 'password', label: 'Choose a new password',
    make: ({ base }) => ({
      subject: 'Choose a new Dime Coach password',
      text: `Hi Casey,\n\nSomeone asked for a new password for your Dime Coach account.\n\nChoose a new password:\n\n${base}/reset?token=sample\n\nThe link works for 1 hour and can be used once. If this was not you, ignore this message and your password stays as it is.`,
    }),
  },
];
