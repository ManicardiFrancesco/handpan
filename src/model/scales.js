/* Handpan scale library.
 *
 * `iv` holds semitone offsets from the ding (index 0 = ding, the lowest note).
 * Real instruments put 7-9 notes on the top shell; "mutant" builds add bottom-
 * shell notes to reach 14-24, and those extras are marked by `bottomFrom`:
 * every index >= bottomFrom is drawn and voiced on the underside.
 *
 * `family` groups the list in the UI. `note` documents provenance: which are
 * real commercial layouts and which are only possible digitally.
 */

export const FAMILIES = ['Classic', 'Exotic', 'Mutant', 'Impossible'];

export const SCALES = [
  /* ------------------------------------------------------------- Classic -- */
  { name:'D Kurd 9', family:'Classic', root:50, iv:[0,7,8,10,12,14,15,17,19],
    note:'The most common handpan scale. D natural minor.' },
  { name:'D Celtic Minor 9', family:'Classic', root:50, iv:[0,7,10,12,14,15,17,19,22],
    note:'Minor hexatonic, no 2nd. Very open and forgiving.' },
  { name:'D Amara / Ysha 8', family:'Classic', root:50, iv:[0,7,10,12,14,15,19,22],
    note:'Aeolian without the 2nd; a classic PANArt-era voicing.' },
  { name:'F Low Pygmy 8', family:'Classic', root:41, iv:[0,3,7,10,12,15,19,22],
    note:'Pentatonic, deep and hypnotic. A real low-F build.' },
  { name:'C# Annaziska 9', family:'Classic', root:49, iv:[0,7,8,11,12,14,15,18,19],
    note:'Harmonic-minor colour with a raised 7th.' },
  { name:'E La Sirena 9', family:'Classic', root:52, iv:[0,7,10,12,14,15,17,19,21],
    note:'Dorian-flavoured minor, bright upper register.' },

  /* -------------------------------------------------------------- Exotic -- */
  { name:'D Hijaz 9', family:'Exotic', root:50, iv:[0,7,8,11,12,13,16,17,19],
    note:'Double-harmonic / Phrygian dominant. Middle-Eastern.' },
  { name:'F Aegean 18', family:'Exotic', root:41, iv:[0,7,12,15,17,19,22,24,26,27,29,31,34,36,38,39,41,43],
    bottomFrom:9,
    note:'Extended Aegean voicing across both shells; airy and modal.' },
  { name:'D Sabye 9', family:'Exotic', root:50, iv:[0,6,7,10,12,13,16,18,19],
    note:'Tritone-inflected and unsettled; strong Arabic character.' },
  { name:'C# Raga Desi 9', family:'Exotic', root:49, iv:[0,7,9,10,12,14,15,17,21],
    note:'Indian raga colour: natural 2nd against a minor 3rd.' },
  { name:'F Blues 9', family:'Exotic', root:41, iv:[0,7,10,12,15,16,17,19,22],
    note:'Minor pentatonic plus the blue note (b5).' },
  { name:'G Oxalis 9', family:'Exotic', root:43, iv:[0,7,11,12,14,16,18,19,23],
    note:'Lydian-ish with a raised 4th; luminous and unusual.' },
  { name:'E Equinox 9', family:'Exotic', root:52, iv:[0,7,8,11,12,15,17,19,20],
    note:'Minor with both b6 and major 7th; dramatic tension.' },
  { name:'B Shang Diao 9', family:'Exotic', root:47, iv:[0,7,9,12,14,16,19,21,24],
    note:'Chinese pentatonic mode, no semitone clashes.' },

  /* -------------------------------------------------------------- Mutant -- */
  { name:'F Low Pygmy 18 (mutant)', family:'Mutant', root:41,
    iv:[0,3,7,10,12,15,19,22,24, 5,8,14,17,20,26,27,29,31], bottomFrom:9,
    note:'Low Pygmy with a full bottom shell filling in the gaps.' },
  { name:'D Kurd 14 (mutant)', family:'Mutant', root:50,
    iv:[0,7,8,10,12,14,15,17,19, 3,5,20,22,24], bottomFrom:9,
    note:'Kurd 9 plus five bottom notes for extra range.' },
  { name:'D Kurd 21 (mutant)', family:'Mutant', root:50,
    iv:[0,7,8,10,12,14,15,17,19,20,22,24,26,27,29,31,32,34,36,38,39], bottomFrom:9,
    note:'Three full octaves of D natural minor. Chord-rich.' },
  { name:'E Integral 21 (mutant)', family:'Mutant', root:52,
    iv:[0,7,9,11,12,14,16,17,19,21,23,24,26,28,29,31,33,35,36,38,40], bottomFrom:9,
    note:'Major-scale mutant; unusually consonant for a handpan.' },
  { name:'C Harmonic Minor 21 (mutant)', family:'Mutant', root:48,
    iv:[0,7,8,11,12,14,15,17,19,20,23,24,26,27,29,31,32,35,36,38,39], bottomFrom:9,
    note:'Harmonic minor over three octaves; augmented triads appear.' },

  /* ---------------------------------------------------------- Impossible -- */
  { name:'D1 Abyss 12 (impossible)', family:'Impossible', root:26,
    iv:[0,12,19,24,26,28,31,33,36,38,40,43], bottomFrom:6,
    note:'Ding at D1 (36.7 Hz) - felt as much as heard. A real shell tuned ' +
         'this low would need to be metres across.' },
  { name:'C1 Leviathan 16 (impossible)', family:'Impossible', root:24,
    iv:[0,7,12,16,19,24,28,31,36,38,40,43,45,47,50,52], bottomFrom:8,
    note:'C1 ding with a wide-spread upper register: sub-bass fundamental ' +
         'under a bright top shell. Physically unbuildable.' },
  { name:'A0 Tectonic 14 (impossible)', family:'Impossible', root:21,
    iv:[0,12,24,28,31,36,40,43,48,52,55,60,64,67], bottomFrom:7,
    note:'Stacked octaves and fifths from A0 up. Maximum coupling: every ' +
         'note is a harmonic of the ding, so one strike wakes the whole shell.' },
  { name:'F#0 Gravity Well 18 (impossible)', family:'Impossible', root:18,
    iv:[0,19,24,31,36,38,43,45,48,50,52,55,57,60,62,64,67,69], bottomFrom:9,
    note:'F#0 (23.1 Hz). Nearly six octaves of range in one instrument.' },
];

/** Convenience: indices grouped by family, preserving list order. */
export function byFamily () {
  const out = new Map(FAMILIES.map(f => [f, []]));
  SCALES.forEach((s, i) => { if (out.has(s.family)) out.get(s.family).push(i); });
  return out;
}

/** True when note index `i` of scale `s` belongs to the bottom shell. */
export function isBottom (s, i) {
  return s.bottomFrom !== undefined && i >= s.bottomFrom;
}
