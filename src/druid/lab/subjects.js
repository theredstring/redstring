/**
 * Subjects for the Druid's benchmark and for gathering what it is asked
 * (scripts/druid-bench.mjs). EVAL is held out: nothing asked about these
 * subjects is ever trained on, so the benchmark measures what a model learned,
 * not what it saw. Spread across the kinds of thing a person asks about:
 * objects, living things, places, processes, systems, substances, ideas.
 *
 * OTHER is what a person asks it to turn to, mid-run: everyday things, as a
 * person would ask about them.
 */

export const EVAL = [
  // The cases that showed what was wrong (The Druid 11 and 12, 2026-10-06).
  'Venus', 'Microscope', 'Space',
  'Bicycle', 'Honeybee', 'Volcano', 'Bread baking', 'Coral reef', 'Human heart', 'Piano',
  'Photosynthesis', 'Medieval castle', 'Thunderstorm', 'Democracy', 'Lighthouse', 'Octopus'
];

export const TRAIN = [
  // Objects and machines
  'Clock', 'Telescope', 'Sailboat', 'Guitar', 'Camera', 'Refrigerator', 'Steam engine', 'Umbrella', 'Typewriter', 'Wind turbine',
  'Submarine', 'Helicopter', 'Printing press', 'Violin', 'Compass', 'Bridge', 'Skyscraper', 'Windmill', 'Kite', 'Car engine',
  'Smartphone', 'Hot air balloon', 'Lock and key', 'Sewing machine', 'Lamp', 'Chair', 'Backpack', 'Tent', 'Rocket', 'Satellite',
  // Living things and the body
  'Oak tree', 'Mushroom', 'Wolf', 'Ant colony', 'Salmon', 'Butterfly', 'Cactus', 'Elephant', 'Spider', 'Penguin',
  'Human eye', 'Human lung', 'Skeleton', 'Brain', 'Tooth', 'Hand', 'Feather', 'Seed', 'Flower', 'Leaf',
  // Places and landforms
  'Mars', 'Jupiter', 'The Moon', 'Desert', 'Rainforest', 'Glacier', 'River delta', 'Mountain', 'Cave', 'Island',
  'Ocean', 'Tide pool', 'Savanna', 'City', 'Farm', 'Library', 'Hospital', 'School', 'Airport', 'Harbor',
  // Processes
  'Digestion', 'Rain', 'Erosion', 'Fermentation', 'Making cheese', 'Brewing coffee', 'Metamorphosis', 'Plate tectonics', 'Evolution', 'Combustion',
  'Water cycle', 'Cell division', 'Pollination', 'Baking a cake', 'Building a house', 'Election', 'Recycling', 'Snowflake formation', 'Star formation', 'Healing a wound',
  // Systems and institutions
  'Solar system', 'Immune system', 'Postal service', 'Orchestra', 'Restaurant kitchen', 'Football team', 'Railway', 'Power grid', 'Internet', 'Bank',
  // Substances and materials
  'Salt', 'Glass', 'Steel', 'Honey', 'Paper', 'Concrete', 'Wool', 'Chocolate', 'Soap', 'Ink',
  // Food
  'Pizza', 'Sushi', 'Pancake', 'Soup', 'Taco', 'Salad', 'Cheeseburger', 'Apple pie', 'Ramen', 'Omelette',
  // Ideas and practices
  'Music', 'Friendship', 'Language', 'Mathematics', 'Money', 'Law', 'Chess', 'Poetry', 'Gardening', 'Navigation'
];

/** What a person asks it to turn to. */
export const OTHER = ['Ham sandwich', 'Submarine sandwich', 'Bicycle bell', 'Teapot', 'Goldfish', 'Pencil', 'Toaster', 'Sandcastle', 'Raincoat', 'Birthday cake', 'Paper airplane', 'Snowman'];

/**
 * What a person says in a run, and when: a moment, and the words (or a
 * function of the world and the subject asked about). The styles are the ones
 * that went unheard (The Druid 11 and 12): a greeting in front, a "let's talk
 * about", a bare name, a question about "it".
 */
export const SCENARIOS = {
  solo: () => [],
  request: (at, other) => [
    { at, text: `hey make a web of a ${other.toLowerCase()} and tell me everything you think is in it`, request: other },
    { at: at + 10, text: "what's in it so far?", question: other }
  ],
  pivot: (at, other) => [
    { at, text: `hey let's talk about a ${other.toLowerCase()}`, request: other },
    { at: at + 3, text: other.toLowerCase(), request: other },
    { at: at + 12, text: 'what have you found?', question: other }
  ],
  polite: (at, other) => [
    { at, text: `can you look into ${other.toLowerCase()}s for me?`, request: other },
    { at: at + 10, text: `what is a ${other.toLowerCase()} made of?`, question: other }
  ]
};
