const initialEntries = [
  {
    id: "entry-1",
    title: "Classic reversal - Bullish",
    bias: "Bullish",
    date: "2026-04-27",
    patterns: ["Bullish", "Reversal"],
    status: "PASSED",
    image: "Images/chart1.png",
    notes: "Price was in a downtrend and reached a strong support zone. Bullish engulfing formed followed by strong momentum. Volume increased on breakout.",
    mistakes: "None, followed rules perfectly.",
    customAttributes: {
      "Market": "Nifty 50",
      "P&L": "₹350"
    }
  },
  {
    id: "entry-2",
    title: "Small retest just below resistant",
    bias: "Bearish",
    date: "2026-04-28",
    patterns: ["Bearish", "VWAP Rejection"],
    status: "PASSED",
    image: "Images/chart2.png",
    notes: "Small retest formed just below resistance. Volume dried up on the retest, signaling lack of buyers. Entered short on confirmation.",
    mistakes: "Entered slightly early before full candle close.",
    customAttributes: {
      "Market": "Nifty 50",
      "P&L": "₹500"
    }
  },
  {
    id: "entry-3",
    title: "Green Hammer at support",
    bias: "Bullish",
    date: "2026-05-04",
    patterns: ["Bullish", "VWAP Support"],
    status: "PASSED",
    image: "Images/chart1.png",
    notes: "Perfect green hammer candle formed right at the major daily support level. Followed by strong follow-through bullish candle.",
    mistakes: "Could have had a tighter stop loss.",
    customAttributes: {
      "Market": "Bank Nifty",
      "P&L": "₹800"
    }
  },
  {
    id: "entry-4",
    title: "Bearish Retracement Red Hammer",
    bias: "Bearish",
    date: "2026-04-30",
    patterns: ["Bearish"],
    status: "FAILED",
    image: "Images/chart2.png",
    notes: "Attempted short play on a bearish retracement. A red hammer formed but was immediately invalidated by a sudden surge in buying volume.",
    mistakes: "Traded against the higher timeframe trend which was bullish.",
    customAttributes: {
      "Market": "Nifty 50",
      "P&L": "-₹250"
    }
  }
];

// Seed tags with specific color presets
const initialTags = [
  // Bullish patterns = Green tags
  { name: "Bullish", color: "#a3b860", bg: "rgba(163, 184, 96, 0.15)", type: "Bullish" },
  { name: "VWAP Support", color: "#10b981", bg: "rgba(16, 185, 129, 0.15)", type: "Bullish" },
  { name: "Green Hammer", color: "#34d399", bg: "rgba(52, 211, 153, 0.15)", type: "Bullish" },
  
  // Bearish patterns = Red tags
  { name: "Bearish", color: "#ef4444", bg: "rgba(239, 68, 68, 0.15)", type: "Bearish" },
  { name: "VWAP Rejection", color: "#f43f5e", bg: "rgba(244, 63, 94, 0.15)", type: "Bearish" },
  { name: "Red Hammer", color: "#fda4af", bg: "rgba(253, 164, 175, 0.15)", type: "Bearish" },
  
  // Common / Reversal tags
  { name: "Reversal", color: "#60a5fa", bg: "rgba(96, 165, 250, 0.15)", type: "Both" },
  { name: "Continuation", color: "#a78bfa", bg: "rgba(167, 139, 250, 0.15)", type: "Both" }
];

const defaultCustomAttributes = [
  { name: "Market", type: "text", defaultValue: "Nifty 50" },
  { name: "P&L", type: "text", defaultValue: "₹0" }
];

// Export to window object for pure browser usage without imports
window.HoneyJournalSeeds = {
  initialEntries,
  initialTags,
  defaultCustomAttributes
};
