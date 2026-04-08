import { describe, expect, it, vi } from "vitest";
import {
  buildStackAppOptions,
  completePendingStackCallback,
  detectPendingStackCallback,
  resolveStackAuthCapabilities,
} from "../../services/wave-control-web/src/stack-auth";

describe("wave-control web stack auth helpers", () => {
  it("builds persistent cookie-backed stack app options on the current app path", () => {
    expect(buildStackAppOptions("stack-project", "pk_test", "/wave-control")).toEqual({
      projectId: "stack-project",
      publishableClientKey: "pk_test",
      tokenStore: "cookie",
      urls: {
        home: "/wave-control",
        afterSignIn: "/wave-control",
        afterSignOut: "/wave-control",
        afterSignUp: "/wave-control",
        oauthCallback: "/wave-control",
        magicLinkCallback: "/wave-control",
      },
    });
  });

  it("distinguishes oauth and magic-link callbacks from the current url", () => {
    expect(detectPendingStackCallback("https://control.example.test/?code=oauth-code&state=oauth-state")).toEqual({
      type: "oauth",
    });
    expect(detectPendingStackCallback("https://control.example.test/?code=magic-code")).toEqual({
      type: "magic-link",
      code: "magic-code",
    });
    expect(detectPendingStackCallback("https://control.example.test/")).toEqual({
      type: "none",
    });
  });

  it("completes oauth callbacks via the stack client", async () => {
    const stackApp = {
      callOAuthCallback: vi.fn().mockResolvedValue(true),
      signInWithMagicLink: vi.fn(),
    };
    const historyLike = {
      replaceState: vi.fn(),
    };

    const completed = await completePendingStackCallback(stackApp, {
      href: "https://control.example.test/?code=oauth-code&state=oauth-state",
      historyLike,
    });

    expect(completed).toBe(true);
    expect(stackApp.callOAuthCallback).toHaveBeenCalledTimes(1);
    expect(stackApp.signInWithMagicLink).not.toHaveBeenCalled();
    expect(historyLike.replaceState).not.toHaveBeenCalled();
  });

  it("completes magic-link callbacks and clears the one-time code from the url", async () => {
    const stackApp = {
      callOAuthCallback: vi.fn(),
      signInWithMagicLink: vi.fn().mockResolvedValue({ status: "ok" }),
    };
    const historyLike = {
      replaceState: vi.fn(),
    };

    const completed = await completePendingStackCallback(stackApp, {
      href: "https://control.example.test/?code=magic-code&view=signin",
      historyLike,
    });

    expect(completed).toBe(true);
    expect(stackApp.callOAuthCallback).not.toHaveBeenCalled();
    expect(stackApp.signInWithMagicLink).toHaveBeenCalledWith("magic-code", {
      noRedirect: true,
    });
    expect(historyLike.replaceState).toHaveBeenCalledWith(
      {},
      "",
      "https://control.example.test/?view=signin",
    );
  });

  it("derives available sign-in methods from the stack project config", () => {
    expect(
      resolveStackAuthCapabilities({
        config: {
          credential_enabled: true,
          magic_link_enabled: true,
          passkey_enabled: false,
          enabled_oauth_providers: [{ id: "github" }, { id: "google" }],
        },
      }),
    ).toEqual({
      credentialEnabled: true,
      magicLinkEnabled: true,
      passkeyEnabled: false,
      oauthProviders: ["github", "google"],
      hasAnyMethod: true,
    });
  });

  it("supports the camelCase project config returned by the Stack client", () => {
    expect(
      resolveStackAuthCapabilities({
        config: {
          credentialEnabled: true,
          magicLinkEnabled: false,
          passkeyEnabled: true,
          oauthProviders: [{ id: "github" }, { id: "google" }],
        },
      }),
    ).toEqual({
      credentialEnabled: true,
      magicLinkEnabled: false,
      passkeyEnabled: true,
      oauthProviders: ["github", "google"],
      hasAnyMethod: true,
    });
  });
});
