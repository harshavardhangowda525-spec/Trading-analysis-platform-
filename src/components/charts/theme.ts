export const VIZ = {
  pos: "#22a37a",
  neg: "#d9532f",
  cat: ["#2f86d6", "#b48a3e", "#a35bc4", "#1d9e93", "#d2682f"],
  grid: "rgba(255,255,255,0.06)",
  axis: "#6c7385",
  line: "#7cc4ff",
  surface: "#12151c",
};
export const axisProps = { stroke: VIZ.axis, tick: { fill: VIZ.axis, fontSize: 10.5 }, tickLine: false, axisLine: false } as const;
