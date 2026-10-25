import { describe, it, expect, beforeEach } from "vitest";
import {
  installMapsAuthFailureHandler,
  isMapsAuthFailed,
  resetMapsAuthFailure,
} from "@/lib/maps-auth";

describe("installMapsAuthFailureHandler", () => {
  beforeEach(() => resetMapsAuthFailure());

  it("records a Google Maps key rejection", () => {
    const target = {};
    installMapsAuthFailureHandler(target);
    expect(isMapsAuthFailed()).toBe(false);
    target.gm_authFailure();
    expect(isMapsAuthFailed()).toBe(true);
  });

  it("keeps a handler that was already installed", () => {
    let calls = 0;
    const target = { gm_authFailure: () => calls++ };
    installMapsAuthFailureHandler(target);
    target.gm_authFailure();
    expect(calls).toBe(1);
    expect(isMapsAuthFailed()).toBe(true);
  });

  it("installs only once", () => {
    let calls = 0;
    const target = { gm_authFailure: () => calls++ };
    installMapsAuthFailureHandler(target);
    installMapsAuthFailureHandler(target);
    target.gm_authFailure();
    expect(calls).toBe(1);
  });
});
