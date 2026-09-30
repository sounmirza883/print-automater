import { nextTabIndex } from "./tabs";

describe("nextTabIndex", () => {
  const count = 5;

  it("moves forward with ArrowDown and ArrowRight, wrapping at the end", () => {
    expect(nextTabIndex("ArrowDown", 0, count)).toBe(1);
    expect(nextTabIndex("ArrowRight", 2, count)).toBe(3);
    expect(nextTabIndex("ArrowDown", 4, count)).toBe(0);
  });

  it("moves back with ArrowUp and ArrowLeft, wrapping at the start", () => {
    expect(nextTabIndex("ArrowUp", 3, count)).toBe(2);
    expect(nextTabIndex("ArrowLeft", 1, count)).toBe(0);
    expect(nextTabIndex("ArrowUp", 0, count)).toBe(4);
  });

  it("jumps to the ends with Home and End", () => {
    expect(nextTabIndex("Home", 3, count)).toBe(0);
    expect(nextTabIndex("End", 1, count)).toBe(4);
  });

  it("ignores other keys and empty lists", () => {
    expect(nextTabIndex("Enter", 2, count)).toBeNull();
    expect(nextTabIndex("a", 2, count)).toBeNull();
    expect(nextTabIndex("ArrowDown", 0, 0)).toBeNull();
  });
});
