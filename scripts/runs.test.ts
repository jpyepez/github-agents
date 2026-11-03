import { describe, expect, test } from "bun:test";
import { busy, neverStarted, runTitle } from "./runs";
import type { Job } from "./tracker";

const job = (name: string, status: string, startedSteps = 1): Job => ({ name, status, startedSteps });

describe("busy", () => {
  const title = runTitle("implement", 5);
  const runs = [
    { id: 1, title },
    { id: 2, title: "Implement issue 6" },
    { id: 3, title },
  ];
  const jobs: Record<number, Job[]> = {
    1: [job("implement / prepare", "completed"), job("implement / agent", "in_progress"), job("implement / apply", "queued", 0)],
    2: [job("implement / agent", "in_progress")],
    3: [job("implement / prepare", "in_progress")],
  };
  const of = (id: number) => jobs[id] ?? [];

  test("finds another run for the same issue whose agent is running", () => expect(busy(runs, of, title, 3)).toBe(1));
  test("ignores its own run and other issues' runs", () => {
    expect(busy(runs.filter((r) => r.id !== 1), of, title, 3)).toBeNull();
    expect(busy([runs[1]!], of, "Implement issue 6", 2)).toBeNull();
  });
  test("ignores a run that's only in prepare, like a skip run for another label", () => {
    expect(busy([{ id: 3, title }], of, title, 9)).toBeNull();
  });
  test("counts a run whose agent waits for its group, or whose apply is still pushing", () => {
    expect(busy([{ id: 4, title }], () => [job("implement / agent", "waiting", 0)], title, 9)).toBe(4);
    expect(busy([{ id: 5, title }], () => [job("implement / agent", "completed"), job("implement / apply", "in_progress")], title, 9)).toBe(5);
  });
  test("titles match the callers' run-name", () => {
    expect(runTitle("triage", 12)).toBe("Triage issue 12");
    expect(runTitle("implement", 12)).toBe("Implement issue 12");
  });
});

describe("neverStarted", () => {
  test("is true for an agent job cancelled while queued", () => {
    expect(neverStarted([job("implement / prepare", "completed"), job("implement / agent", "completed", 0)])).toBe(true);
  });
  test("is false for an agent that started and then timed out or failed", () => {
    expect(neverStarted([job("implement / agent", "completed", 7)])).toBe(false);
  });
  test("is false when there is no agent job to judge", () => expect(neverStarted([job("implement / prepare", "completed")])).toBe(false));
});
