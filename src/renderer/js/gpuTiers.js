// Rough relative gaming performance (RTX 4090 = 100). Order matters: specific names first.
// Good enough to answer "can it run X?", not a leaderboard.
const TIERS = [
  [/rtx\s*5090/, 125], [/rtx\s*5080/, 84], [/rtx\s*5070\s*ti/, 72], [/rtx\s*5070/, 58], [/rtx\s*5060\s*ti/, 44], [/rtx\s*5060/, 38], [/rtx\s*5050/, 28],
  [/rtx\s*4090/, 100], [/rtx\s*4080\s*super/, 80], [/rtx\s*4080/, 78], [/rtx\s*4070\s*ti\s*super/, 68], [/rtx\s*4070\s*ti/, 62], [/rtx\s*4070\s*super/, 58],
  [/rtx\s*4070/, 50], [/rtx\s*4060\s*ti/, 40], [/rtx\s*4060/, 32], [/rtx\s*4050/, 25],
  [/rtx\s*3090\s*ti/, 62], [/rtx\s*3090/, 57], [/rtx\s*3080\s*ti/, 55], [/rtx\s*3080/, 51], [/rtx\s*3070\s*ti/, 44], [/rtx\s*3070/, 41], [/rtx\s*3060\s*ti/, 37],
  [/rtx\s*3060/, 28], [/rtx\s*3050/, 18],
  [/rtx\s*2080\s*ti/, 40], [/rtx\s*2080\s*super/, 34], [/rtx\s*2080/, 32], [/rtx\s*2070\s*super/, 30], [/rtx\s*2070/, 26], [/rtx\s*2060\s*super/, 24], [/rtx\s*2060/, 21],
  [/gtx\s*1660\s*(ti|super)/, 17], [/gtx\s*1660/, 15], [/gtx\s*1650\s*super/, 13], [/gtx\s*1650/, 10], [/gtx\s*1630/, 6],
  [/gtx\s*1080\s*ti/, 28], [/gtx\s*1080/, 22], [/gtx\s*1070\s*ti/, 20], [/gtx\s*1070/, 18], [/gtx\s*1060/, 13], [/gtx\s*1050\s*ti/, 7], [/gtx\s*1050/, 5.5],
  [/gtx\s*980\s*ti/, 14], [/gtx\s*980/, 11], [/gtx\s*970/, 9], [/gtx\s*960/, 6], [/gtx\s*950/, 4.5], [/gtx\s*750\s*ti/, 3.5],
  [/mx\s*5[57]0/, 5], [/mx\s*450/, 4.5], [/mx\s*\d{3}/, 3],
  [/rx\s*9070\s*xt/, 70], [/rx\s*9070/, 63], [/rx\s*9060\s*xt/, 40], [/rx\s*9060/, 34],
  [/rx\s*7900\s*xtx/, 78], [/rx\s*7900\s*xt/, 68], [/rx\s*7900\s*gre/, 55], [/rx\s*7800\s*xt/, 50], [/rx\s*7700\s*xt/, 43], [/rx\s*7600\s*xt/, 32], [/rx\s*7600/, 31],
  [/rx\s*6950\s*xt/, 55], [/rx\s*6900\s*xt/, 52], [/rx\s*6800\s*xt/, 50], [/rx\s*6800/, 44], [/rx\s*6750\s*xt/, 38], [/rx\s*6700\s*xt/, 36], [/rx\s*6700/, 33],
  [/rx\s*6650\s*xt/, 31], [/rx\s*6600\s*xt/, 30], [/rx\s*6600/, 26], [/rx\s*6500\s*xt/, 12], [/rx\s*6400/, 9],
  [/rx\s*5700\s*xt/, 26], [/rx\s*5700/, 23], [/rx\s*5600\s*xt/, 20], [/rx\s*5500\s*xt/, 13],
  [/rx\s*590/, 13], [/rx\s*580/, 12], [/rx\s*570/, 11], [/rx\s*480/, 12], [/rx\s*470/, 10], [/rx\s*560|rx\s*460/, 6], [/rx\s*550/, 4],
  [/vega\s*64/, 20], [/vega\s*56/, 17], [/radeon\s*vii/, 26],
  [/arc\s*b580/, 34], [/arc\s*b570/, 29], [/arc\s*a770/, 31], [/arc\s*a750/, 29], [/arc\s*a580/, 25], [/arc\s*a380/, 10], [/arc\s*a3\d0m?/, 8],
  // Integrated graphics
  [/radeon\s*890m/, 14], [/radeon\s*880m/, 12], [/radeon\s*780m/, 11], [/radeon\s*760m/, 9], [/radeon\s*680m/, 9], [/radeon\s*660m/, 7], [/radeon\s*740m|radeon\s*610m/, 4],
  [/arc\s*1[34]0v/, 13], [/intel.*arc/, 9],
  [/vega\s*(8|10|11)|radeon\s*(rx\s*)?vega/, 3], [/radeon.*graphics/, 3.5],
  [/iris\s*xe/, 3.5], [/iris\s*plus/, 2], [/uhd\s*graphics\s*7\d\d/, 2], [/uhd/, 1.5], [/hd\s*graphics/, 1],
];

export function gpuScore(name) {
  const n = (name || '').toLowerCase().replace(/nvidia|geforce|amd|intel\(r\)|\(r\)|\(tm\)/g, ' ').replace(/\s+/g, ' ');
  for (const [re, score] of TIERS) if (re.test(n)) return score;
  return null;
}

// Laptop versions of the same chip run at lower power: roughly 80% of the desktop card.
export function effectiveGpuScore(gpu, isLaptop) {
  if (!gpu) return 0;
  const s = gpuScore(gpu.name);
  if (s == null) return gpu.discrete ? 8 : 1.5;
  return gpu.discrete && (isLaptop || /laptop|mobile|max-q/i.test(gpu.name)) ? Math.round(s * 0.8 * 10) / 10 : s;
}

const bucket = (s, rows) => {
  for (const [min, text, level] of rows) if (s >= min) return { text, level };
  return { text: rows[rows.length - 1][1], level: 'fail' };
};

export function fpsEstimates(score, cpuSingle) {
  const cpuNote = cpuSingle && cpuSingle < 950 ? 'The CPU will hold this back a bit.' : null;
  return [
    {
      game: 'Esports',
      examples: 'Valorant, CS2, League, Fortnite (performance mode)',
      res: '1080p',
      ...bucket(score, [[30, '240+ FPS', 'great'], [15, '144+ FPS', 'great'], [8, '100–144 FPS', 'ok'], [4, '60–100 FPS on low', 'ok'], [1.8, '~60 FPS on lowest', 'weak'], [0, 'Choppy (under 40 FPS)', 'fail']]),
      note: cpuNote,
    },
    {
      game: 'Minecraft & indie games',
      examples: 'Minecraft, Stardew Valley, Terraria, Hollow Knight',
      res: '1080p',
      ...bucket(score, [[10, 'Smooth, even with shaders', 'great'], [4, 'Smooth (no shaders)', 'ok'], [1.5, 'Playable, short render distance', 'weak'], [0, 'Choppy', 'fail']]),
    },
    {
      game: 'Modern AAA',
      examples: 'Cyberpunk 2077, Elden Ring, Call of Duty, GTA V',
      res: '1080p',
      ...bucket(score, [[55, '100+ FPS on Ultra', 'great'], [38, '80–100 FPS on High', 'great'], [25, '60+ FPS on High', 'great'], [16, '50–60 FPS on Medium', 'ok'], [10, '40–50 FPS on Low–Medium', 'ok'], [7, '30–40 FPS on Low', 'weak'], [4, '~25–30 FPS on lowest', 'weak'], [0, 'Not playable', 'fail']]),
      note: cpuNote,
    },
    {
      game: 'Modern AAA',
      examples: 'Same games, sharper picture',
      res: '1440p',
      ...bucket(score, [[70, '100+ FPS on Ultra', 'great'], [50, '70–90 FPS on High', 'great'], [35, '60 FPS on High', 'ok'], [24, '45–60 FPS on Medium', 'ok'], [15, '30–40 FPS on Low', 'weak'], [0, 'Not recommended', 'fail']]),
    },
    {
      game: '4K gaming',
      examples: 'The big-TV dream',
      res: '4K',
      ...bucket(score, [[90, '60+ FPS on High', 'great'], [65, '45–60 FPS with upscaling (DLSS/FSR)', 'ok'], [45, '30–45 FPS with upscaling', 'weak'], [0, 'Not recommended', 'fail']]),
    },
  ];
}
