import { PullScreen } from "@/components/pull/PullScreen";

const PORTFOLIO = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "ITC", "LT", "SUNPHARMA",
  "MARUTI", "TITAN", "BAJFINANCE", "ADANIPORTS", "ASIANPAINT", "TATASTEEL",
  "ETERNAL", "DIXON", "POLYCAB", "PERSISTENT",
];

export default function Page() {
  return <PullScreen portfolio={PORTFOLIO} />;
}