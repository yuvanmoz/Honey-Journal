// Empty seeds - first launch starts with completely clean database
const initialEntries = [];

// No default tags - user creates all patterns themselves
const initialTags = [];

const defaultCustomAttributes = [
  { name: "Market", type: "text", defaultValue: "" },
  { name: "P&L", type: "number", defaultValue: 0 }
];

// Export to window object for pure browser usage without imports
window.HoneyJournalSeeds = {
  initialEntries,
  initialTags,
  defaultCustomAttributes
};
