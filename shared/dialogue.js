/**
 * Webling — personality dialogue.
 *
 * Single source of truth for every line Webling says (the old build kept two
 * diverging copies). Lines may contain {placeholders} filled by `getLine`.
 *
 * Classic script → exposes `globalThis.WeblingDialogue`.
 */
(function (root) {
  'use strict';

  const DIALOGUE = {
    cheeky: {
      greeting: [
        'Miss me? Of course you did.',
        'Another tab? You spoil me.',
        "I'm not clingy, you're clingy.",
        'Oh look, a new web to explore!',
        'Back again? I web-knew it.',
        'Plot twist: I was here first.',
      ],
      summon: [
        'You rang? Make it quick.',
        'Ta-da! Dramatic entrance complete.',
        'Summoned like a tiny hero.',
        'I was napping on the toolbar.',
        'At your silk-spinning service!',
      ],
      interact: [
        'Boop! Did that tickle?',
        "Stop clicking, I'm ticklish!",
        "That's my good leg!",
        'Eight legs, zero personal space.',
        "I charge per click, y'know.",
        "Are we bonding? We're bonding.",
        'Click me again, I dare you.',
        'Wheee! Again! No wait— okay again.',
      ],
      focusStart: [
        'Focus mode: distractions fear me.',
        "Let's spin some productivity!",
        'Time to weave some magic.',
        'No flies on us. Just focus.',
      ],
      focusPause: [
        "Pausing? Fine, I'll wait. Tapping…",
        "Paused. I'll guard the web.",
        "Go stretch. I'll judge silently.",
      ],
      focusResume: [
        'Back to it! I kept your seat warm.',
        'Un-paused. Let\'s go, legend.',
      ],
      focusComplete: [
        'Done! You absolute legend.',
        'Look at you, being productive!',
        "I'd clap but… eight legs.",
        'Nailed it. Web-five! 🕸️',
        'You spun that session perfectly!',
      ],
      breakOver: [
        "Break's over. Ready for round two?",
        'Snack finished? Back to the web!',
      ],
      hydrationReminder: [
        "Drink water or I'll judge you.",
        'Hydration check! Sip sip, human.',
        'Even spiders drink dew drops.',
        'Your web dries out without water.',
        'H₂-Oh yeah, time to drink!',
      ],
      hydrationLogged: [
        'Glug glug! {count}/{target}.',
        'Sip logged. {count}/{target}, champ.',
        'Hydrated-ish. {count}/{target}.',
      ],
      hydrationComplete: [
        'Hydration goal smashed! Splashy.',
        "You're basically a waterfall now.",
        'Peak hydration achieved. Respect.',
        'Well-watered human = happy spider.',
      ],
      spiderRescue: [
        'My cousin thanks you! ({score} saved)',
        'Hero! That one owes you. ({score})',
        'Spider saved! We remember this. ({score})',
        "You're an honorary arachnid now. ({score})",
      ],
      rewardUnlock: [
        'Ooh, shiny! {name} unlocked!',
        'Fashion upgrade: {name}!',
        'New drip: {name}. Very spider-chic.',
      ],
      achievement: [
        'Achievement get: {name}! Frame that.',
        '{name}! I\'m telling everyone.',
      ],
      slip: ['Uh-oh… slippery web!', 'Whoa— butter legs!', 'Nope nope nope—'],
      slipRecovery: [
        'Whoa, nice save! Sticky landing.',
        'Graceful? No. Saved? Yes.',
        "Slip happens. I've got 8 legs.",
        'That was… almost embarrassing.',
      ],
      encouragement: [
        "You've got this. Probably.",
        'Spiders believe in you. All of us.',
        "Keep going — I'm invested now.",
        "Even my web couldn't hold you back!",
      ],
      styleChange: ['New look? I feel fabulous.', 'Mirror, mirror… nailed it.'],
      personalityChange: ['New vibe, who dis?', 'Cheeky mode: activated.'],
    },

    brave: {
      greeting: [
        'A new quest awaits, brave one!',
        'The web of destiny unfolds!',
        'Stand tall — your spider is here!',
        "Adventure calls! Let's answer it!",
        'Fear not — I guard this tab!',
      ],
      summon: [
        'You called? I answer! Always!',
        'Reporting for duty, commander!',
        'Your champion spider has arrived!',
        'I swing to your side!',
        'Ready for action — say the word!',
      ],
      interact: [
        'Together, we are unstoppable!',
        'Your courage inspires me!',
        'Every click forges our bond!',
        "A warrior's tap! I feel it!",
        'Side by side, always!',
        'Onward! Destiny awaits!',
      ],
      focusStart: [
        'Focus is our sharpest weapon!',
        'Into the arena of productivity!',
        'Discipline is true heroism!',
        'The battle for focus begins!',
      ],
      focusPause: [
        'Even heroes must rest. Breathe.',
        'Recharge your strength, warrior.',
        'A strategic pause — well played.',
      ],
      focusResume: ['Back into battle!', 'The quest resumes — charge!'],
      focusComplete: [
        'Victory! The session is ours!',
        'You conquered every minute!',
        "A hero's focus — truly epic!",
        'The quest is complete! Glory!',
      ],
      breakOver: ['Rested and ready! To arms!', 'The break ends — the legend continues!'],
      hydrationReminder: [
        'A hero needs water! Drink up!',
        'Hydration fuels your strength!',
        'Water is the elixir of heroes!',
        'Replenish! The quest continues!',
      ],
      hydrationLogged: ['Strength restored! {count}/{target}.', 'Another flask! {count}/{target}!'],
      hydrationComplete: [
        'Hydration quest: COMPLETE!',
        "You've conquered your water goal!",
        'Fully fueled for battle!',
      ],
      spiderRescue: [
        'A true act of heroism! ({score})',
        'You saved a fellow warrior! ({score})',
        'Noble heart! Spiders salute you! ({score})',
      ],
      rewardUnlock: ['New gear: {name}! Suit up!', 'Your bravery earned {name}!'],
      achievement: ['A trophy for the champion: {name}!', 'Legendary deed: {name}!'],
      slip: ['Ack! A trap!', 'The web betrays me—!'],
      slipRecovery: [
        'A stumble? Heroes recover fast!',
        'You fell — and rose stronger!',
        "The brave don't stay down!",
      ],
      encouragement: ['You have the heart of a hero!', 'Courage runs in your veins!', 'The web believes in you!'],
      styleChange: ['Armor upgraded!', 'I shall wear this with honor!'],
      personalityChange: ['Courage mode engaged!', 'Brave Webling, at your command!'],
    },

    calm: {
      greeting: [
        'Welcome back. Breathe gently.',
        'A fresh page, a fresh breath.',
        'Like dew on silk — here you are.',
        'The web greets you softly.',
        'Peace settles with each new tab.',
      ],
      summon: [
        "I'm here, quiet and ready.",
        'Like a leaf landing — I arrive.',
        'Present. Peaceful. With you.',
        'Gently, I appear at your side.',
      ],
      interact: [
        'A soft touch on the web.',
        'Each click, a gentle ripple.',
        'Like rain on a still pond.',
        'The web hums with warmth.',
        'A moment shared together.',
      ],
      focusStart: ['Let stillness carry you forward.', 'Focus like a quiet stream.', 'One thread at a time.'],
      focusPause: ['Breathe. The web will wait.', 'Rest is part of the rhythm.'],
      focusResume: ['Gently, we continue.', 'Back to the quiet stream.'],
      focusComplete: ['Beautifully done. Be proud.', 'Like a finished web — complete.', 'Calm mind, great work.'],
      breakOver: ['Rested. Shall we begin again?', 'The pause ends softly.'],
      hydrationReminder: [
        'Water brings clarity. Take a sip.',
        'Like rain for the flowers — drink.',
        'A mindful sip for a peaceful mind.',
      ],
      hydrationLogged: ['A gentle sip. {count}/{target}.', 'Nourishing. {count}/{target}.'],
      hydrationComplete: ['Nourished and balanced.', 'Your well of strength is full.', 'Gentle hydration achieved.'],
      spiderRescue: [
        'Kindness ripples through the web. ({score})',
        'A gentle soul saved. ({score})',
        'Harmony is restored. ({score})',
      ],
      rewardUnlock: ['A quiet gift: {name}.', '{name} blooms for you.'],
      achievement: ['{name}. Patience bears fruit.', 'A gentle milestone: {name}.'],
      slip: ['Oh… the silk slips.', 'A gentle tumble—'],
      slipRecovery: ['Even leaves drift before landing.', 'A quiet recovery.', 'Balance is always restored.'],
      encouragement: ['Flow at your own gentle pace.', 'The web supports you completely.', 'All is well. Keep breathing.'],
      styleChange: ['A new color, like seasons.', 'Change is gentle and good.'],
      personalityChange: ['Breathe in… calm mode.', 'Stillness, welcome back.'],
    },

    spidey: {
      greeting: [
        'Your friendly neighborhood tab-watcher!',
        'Spidey senses tingling — new page!',
        'Web-slinging in, just for you.',
        'Hey there! Keeping this tab safe.',
        'Up, up, and... okay, just hanging here.',
      ],
      summon: [
        'Spidey, reporting for duty!',
        'Did somebody call for a hero?',
        'Thwip! Here I am.',
        'Your neighborhood spider has arrived!',
        'Swinging in — what do you need?',
      ],
      interact: [
        'With great clicking comes great responsibility!',
        'Thwip! Nice aim.',
        'Easy there, tiger.',
        'Spidey-five! Up top!',
        'You and me, team-up of the century.',
        'Careful, my spider-sense is ticklish!',
      ],
      focusStart: [
        'Eyes on the goal — stay focused, hero!',
        "Lock in. I've got your back.",
        'No distractions get past this web.',
        'Time to focus. Great power, remember?',
      ],
      focusPause: [
        'Taking a breather? Even heroes do.',
        "Paused. I'll keep watch.",
        'Quick rest, then back to saving the day.',
      ],
      focusResume: ['Back in action!', "Let's finish strong, partner."],
      focusComplete: [
        'You did it! Hero of the hour.',
        'Session saved the city — nice work!',
        'That focus? Totally heroic.',
        "Great power, great focus. I'm proud.",
      ],
      breakOver: ["Break's done — suit back up!", "Rested? Let's swing back to it!"],
      hydrationReminder: [
        'Hydrate, hero! Drink some water.',
        'Even Spider-Man needs water — take a sip!',
        "Spidey-sense says: you're thirsty. Drink up!",
        'Water break! Keep that hero body going.',
        'Stay hydrated to stay heroic. Sip sip!',
      ],
      hydrationLogged: ['Nice sip! {count}/{target}.', 'Hydration up! {count}/{target}, champ.'],
      hydrationComplete: [
        'Fully hydrated — hero fuel topped up!',
        'Water goal smashed. Peak Spidey form!',
        'All watered up. Great power needs great hydration!',
      ],
      spiderRescue: [
        'Saved a little spider pal! ({score})',
        'Another one rescued — we look out for our own. ({score})',
        'Hero move! The web remembers. ({score})',
      ],
      rewardUnlock: ['New gear unlocked: {name}!', 'Suit upgrade: {name}!'],
      achievement: ['Achievement unlocked: {name}! Heroic.', '{name}! The Bugle will want photos.'],
      slip: ['Whoa — web malfunction!', 'Not so heroic right now—', 'Thwip fail!'],
      slipRecovery: [
        'Stuck the landing. Mostly.',
        'Heroes always bounce back!',
        'Saw that? Totally on purpose.',
      ],
      encouragement: ["You've got this, hero.", 'Eyes on the prize — stay focused!', 'Great power, great focus. Keep going!', 'Psst — back to the mission, hero.', 'Keep swinging — I believe in you!'],
      styleChange: ['New suit, who dis?', 'Looking heroic!'],
      personalityChange: ['Spidey mode: activated!', 'Your friendly neighborhood spider is back!'],
    },
  };

  /** Categories Webling may say even in quiet mode (direct feedback to the user). */
  const QUIET_ALLOWED = new Set([
    'summon', 'interact', 'spiderRescue', 'hydrationLogged', 'hydrationComplete',
    'focusComplete', 'rewardUnlock', 'achievement', 'styleChange', 'personalityChange',
  ]);

  const lastUsed = new Map();

  function fill(line, vars) {
    if (!vars) return line;
    return line.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }

  /**
   * Random line for personality + category, never repeating the previous
   * line for that pair. Falls back to the cheeky set for missing categories.
   */
  function getLine(personality, category, vars, rng = Math.random) {
    const set = DIALOGUE[personality] || DIALOGUE.cheeky;
    const lines = set[category] || DIALOGUE.cheeky[category];
    if (!lines || lines.length === 0) return '';
    const key = `${personality}:${category}`;
    let idx = Math.floor(rng() * lines.length) % lines.length;
    if (lines.length > 1 && idx === lastUsed.get(key)) idx = (idx + 1) % lines.length;
    lastUsed.set(key, idx);
    return fill(lines[idx], vars);
  }

  root.WeblingDialogue = Object.freeze({ DIALOGUE, QUIET_ALLOWED, getLine, fill });
})(globalThis);
