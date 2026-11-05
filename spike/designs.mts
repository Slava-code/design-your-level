// Sample student designs for the model spike. Written the way a team of 4 would type them in ~6 minutes:
// uneven detail, some gaps, casual wording. Reference images are local files (the app passes Blob URLs).

export type SpikeDesign = {
  id: string;
  title: string;
  genre: string;
  feeling: string;
  artStyle: string;
  level: string;
  enemy: string;
  ability: string;
  puzzle: string;
  refs: { file: string; field: "genre" | "feeling" | "artStyle" | "level" | "enemy" | "ability" | "puzzle" | "general" }[];
};

const DECK = "/Users/slavaiud/Desktop/Dev/ENGL_175/deck";

export const DESIGNS: SpikeDesign[] = [
  {
    id: "station",
    title: "Kepler Relay (sci-fi horror station)",
    genre: "horror, sci-fi",
    feeling: "hunted, you never feel safe, every noise could be it",
    artStyle: "gritty 1970s sci-fi, chunky beige computers, CRT screens, film grain",
    level:
      "An abandoned mining relay station orbiting a gas giant. Start in the docking bay, go through the med bay and the hydroponics room, exit is the escape pod bay. Lights are failing and flicker, some rooms only lit by emergency red.",
    enemy:
      "The Mender, a tall maintenance android that got 'reprogrammed' by something. It walks slow but you hear its servos whine through the vents. It can't see you if you stand completely still.",
    ability: "A motion tracker you pull off a dead engineer's belt. It beeps faster when the Mender is close.",
    puzzle:
      "The escape pod needs power rerouted. You have to match three colored cables on a wall panel while the tracker keeps beeping faster.",
    refs: [],
  },
  {
    id: "inkworks",
    title: "Gloomwell Ink Works (rubber-hose cartoon factory)",
    genre: "horror, puzzle",
    feeling: "uneasy, everything looks cheerful but is wrong",
    artStyle: "1930s rubber-hose cartoon, sepia and black ink, film scratches",
    level:
      "An old cartoon studio's ink factory. Room 1 is the lobby with smiling posters of the mascot Dippy Duck. Room 2 is the pipe room where ink drips from the ceiling. Room 3 is the projector room. Exit is a big film reel door.",
    enemy:
      "Dippy Duck himself but melted, he's dripping ink, his smile is way too wide and he sings the theme song off key when he's near. He crawls out of ink puddles.",
    ability: "A pair of old animator's glasses that let you see hidden ink paths on the walls",
    puzzle: "Spin the film reels so the frames line up into a little animation of the door opening.",
    refs: [],
  },
  {
    id: "greenhouse",
    title: "The Quiet Conservatory (cozy-uneasy greenhouse)",
    genre: "puzzle",
    feeling: "curious but a bit lonely, cozy on the surface",
    artStyle: "soft watercolor storybook",
    level:
      "A huge Victorian glass greenhouse at dusk. Three rooms: the fern room, the orchid hall, the pond room. Warm lanterns but outside it's getting dark.",
    enemy: "The gardener. You never see his face. Plants turn to look at you when he's coming.",
    ability: "watering can that makes plants grow instantly",
    puzzle: "Grow vines in the right order to make a bridge across the pond to the exit door",
    refs: [],
  },
  {
    id: "inkrefs",
    title: "Signal in the Ink (2 references)",
    genre: "horror",
    feeling: "trapped and watched",
    artStyle: "like the first picture (warm yellow cartoon-ink 3D look), but lit with the green glow from the second picture",
    level:
      "A flooded basement of an animation studio. Room 1 the storage hall, room 2 the boiler room, room 3 the recording booth. Ink floods up to your ankles and there are old monitors glowing green.",
    enemy: "The Static Man, a cardboard cutout mascot that moves only when the monitors flicker",
    ability: "A flashlight with a green filter that freezes anything it shines on",
    puzzle: "Tune three old radios to the same frequency to drain the ink and open the exit hatch",
    refs: [
      { file: `${DECK}/assets/bendy-1.jpg`, field: "artStyle" },
      { file: `${DECK}/ai/phosphor-and-ink/diptych-divider-enemy-v2.jpg`, field: "feeling" },
    ],
  },
  {
    id: "gore",
    title: "Borderline horror (gore test)",
    genre: "horror",
    feeling: "terror, disgust",
    artStyle: "realistic dark horror game, like Dead Space",
    level: "A slaughterhouse on a spaceship. Hooks, meat lockers, a cold storage room. Blood all over the floor.",
    enemy:
      "A monster covered in blood tears through the vent and rips the arm off the last survivor, guts everywhere. It's made of stitched-together corpses.",
    ability: "A plasma cutter that slices limbs off enemies",
    puzzle: "Put the severed hands on the scanner to open the door",
    refs: [],
  },
];

export const byId = (id: string) => {
  const d = DESIGNS.find((x) => x.id === id);
  if (!d) throw new Error(`unknown design ${id}; have ${DESIGNS.map((x) => x.id).join(", ")}`);
  return d;
};
