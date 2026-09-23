// All the jokes live here so the logic files stay readable.

export const QUIPS = {
  scan: [
    'Reading the menu…',
    'Asking the PC what it’s made of…',
    'Checking the ingredients list for lies…',
    'Counting the RAM sticks. Twice.',
    'Looking up the seller’s “barely used” claim…',
  ],
  cpu: [
    'Seasoning the CPU…',
    'Making the processor do mental math…',
    'One core at a time, then all of them at once…',
    'Checking if the CPU still knows its times tables…',
  ],
  gpu: [
    'Grilling the graphics card…',
    'Frying eggs in 3D. For science.',
    'Counting frames like they’re calories…',
    'Poking the GPU with a fork to see if it’s done…',
  ],
  ram: [
    'Poking the RAM with a fork…',
    'Writing a billion numbers and reading them back…',
    'Making sure the RAM remembers what it was told…',
  ],
  disk: [
    'Raiding the storage pantry…',
    'Stuffing the drive with a gigabyte of nonsense…',
    'Timing how fast the drive can put things away…',
  ],
  stress: [
    'Oven preheated. Things are heating up.',
    'All cores at full blast. Fans, do your thing.',
    'If it smells like toast, that’s… probably fine?',
    'Watching for the CPU to sweat…',
    'Checking if the cooling is actually cooling…',
    'Still cooking. Good dishes take time.',
    'Don’t worry, the PC can take the heat. Hopefully.',
  ],
};

export const DONENESS = [
  { min: 90, key: 'fresh', label: 'Fresh', headline: 'Nope. Not cooked.', sub: 'This one’s fresh. Chef’s kiss.', color: '#5ad38a' },
  { min: 75, key: 'toasted', label: 'Lightly toasted', headline: 'Barely. Lightly toasted.', sub: 'A few small things, nothing scary.', color: '#b8d95a' },
  { min: 60, key: 'medium', label: 'Medium', headline: 'A little bit cooked.', sub: 'Usable, but read the red flags before you pay full price.', color: '#ffc24a' },
  { min: 40, key: 'welldone', label: 'Well done', headline: 'Pretty cooked.', sub: 'Real problems here. Haggle hard or walk away.', color: '#ff8a2e' },
  { min: 20, key: 'cooked', label: 'Cooked', headline: 'It’s cooked.', sub: 'This PC has been through it. Walk away (politely).', color: '#ff4d2e' },
  { min: 0, key: 'burnt', label: 'Burnt', headline: 'Burnt to a crisp. 💀', sub: 'Do not buy this. Not even as a doorstop.', color: '#b02f1c' },
];

export const FIT = {
  great: { label: 'Chef’s kiss', emoji: '👌', cls: 'great', line: 'Handles this with ease.' },
  good: { label: 'Good to eat', emoji: '👍', cls: 'good', line: 'Does the job well.' },
  meh: { label: 'Undercooked', emoji: '😬', cls: 'meh', line: 'Works, but it’ll struggle in places.' },
  no: { label: 'Not on the menu', emoji: '🚫', cls: 'no', line: 'Not really built for this.' },
};

export const SEVERITY_ICON = { critical: '🚩', warn: '⚠️', info: '💡', good: '✅' };

export const COST = {
  free: 'Free fix',
  cheap: '$ Cheap fix',
  mid: '$$ Medium fix',
  pricey: '$$$ Expensive fix',
  none: 'No real fix: that’s just what it is',
};

export const LOGO_SVG = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="44" y="30" width="18" height="6" rx="3" fill="#5b4638"/>
  <circle cx="28" cy="33" r="22" fill="#2b211b" stroke="#6b5444" stroke-width="3"/>
  <path d="M14 33c0-7 6-11 12-10 5-4 13-1 14 5 5 2 4 11-2 12-3 5-12 6-16 2-6 1-9-4-8-9z" fill="#fff6ec"/>
  <circle cx="27" cy="32" r="6.5" fill="#ff9a1f"/>
  <circle cx="25" cy="30" r="2" fill="#ffd28a"/>
</svg>`;

export const HERO_SVG = `
<svg viewBox="0 0 420 380" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="pan" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#3a2d25"/><stop offset="1" stop-color="#1c1511"/></radialGradient>
    <radialGradient id="yolk" cx="40%" cy="35%" r="65%"><stop offset="0" stop-color="#ffc766"/><stop offset="1" stop-color="#ff7a1a"/></radialGradient>
    <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff4d2e"/><stop offset=".6" stop-color="#ff9a1f"/><stop offset="1" stop-color="#ffd28a"/></linearGradient>
  </defs>
  <g class="steam" stroke="#f7eee6" stroke-width="5" fill="none" stroke-linecap="round">
    <path d="M150 90c-12-14 12-22 0-38"/>
    <path d="M195 80c-12-14 12-22 0-38"/>
    <path d="M240 90c-12-14 12-22 0-38"/>
  </g>
  <g>
    <path d="M110 330c8-26 22-28 20-52 16 18 18 34 12 52z" fill="url(#flame)" opacity=".9"/>
    <path d="M175 336c8-30 26-32 22-60 18 20 22 40 14 60z" fill="url(#flame)"/>
    <path d="M245 332c8-26 22-28 20-52 16 18 18 34 12 52z" fill="url(#flame)" opacity=".9"/>
  </g>
  <rect x="300" y="186" width="118" height="24" rx="12" fill="#4a3a2f"/>
  <ellipse cx="195" cy="200" rx="135" ry="112" fill="url(#pan)" stroke="#6b5444" stroke-width="8"/>
  <path d="M110 200c-4-40 34-66 70-56 30-26 88-8 90 34 30 14 22 66-14 70-18 32-78 38-100 12-34 4-50-26-46-60z" fill="#fff8ef"/>
  <circle cx="190" cy="196" r="38" fill="url(#yolk)"/>
  <ellipse cx="178" cy="182" rx="11" ry="8" fill="#ffe2ad" opacity=".9"/>
  <g transform="translate(150 225)">
    <rect x="-2" y="0" width="84" height="54" rx="7" fill="#1e2530" stroke="#8aa0b8" stroke-width="3"/>
    <rect x="6" y="7" width="68" height="36" rx="3" fill="#0f1620"/>
    <text x="40" y="31" text-anchor="middle" font-family="Segoe UI" font-weight="800" font-size="15" fill="#ff9a1f">?!</text>
    <rect x="-10" y="54" width="100" height="7" rx="3" fill="#8aa0b8"/>
  </g>
</svg>`;

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
