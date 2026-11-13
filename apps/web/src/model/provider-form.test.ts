import { describe, expect, it } from "vitest";
import { addressProblem, endpointIdentity, knownVision, providerPresets } from "./provider-form";

describe("connection form boundaries", () => {
  it("distinguishes API keys from service URLs before any request", () => {
    expect(addressProblem("sk-test-key", false)).toBe("connection.keyInAddress");
    expect(addressProblem("Bearer test-key", false)).toBe("connection.keyInAddress");
    expect(addressProblem("https://service.example/v1?api_key=test", false)).toBe("connection.addressInvalid");
    expect(addressProblem("https://user:pass@service.example/v1", false)).toBe("connection.addressInvalid");
  });
  it("requires explicit local access and a compatible HTTP endpoint", () => {
    expect(addressProblem("http://localhost:11434/v1", false)).toBe("connection.localDisabled");
    expect(addressProblem("http://localhost:11434/v1", true)).toBeNull();
    expect(addressProblem("http://remote.example/v1", true)).toBe("connection.httpsRequired");
    expect(addressProblem("https://service.example/v1/messages", false)).toBe("connection.protocolMismatch");
    expect(addressProblem("https://service.example/v1", false)).toBeNull();
  });
  it("keeps equivalent completion URLs together without sharing keys across tenants", () => {
    expect(endpointIdentity("https://service.example/v1/")).toBe(endpointIdentity("https://service.example/v1/chat/completions"));
    expect(endpointIdentity("https://service.example/tenant-a/v1")).not.toBe(endpointIdentity("https://service.example/tenant-b/v1"));
  });
  it("limits automatic vision presets to documented models on the official endpoint", () => {
    expect(knownVision(providerPresets.deepseek.url, "deepseek-flash")).toBe(true);
    expect(knownVision(providerPresets.deepseek.url, "deepseek-v4-pro")).toBe(false);
    expect(knownVision("https://proxy.example/v1", "deepseek-flash")).toBeUndefined();
    expect(knownVision(providerPresets.deepseek.url, "user-model-alias")).toBeUndefined();
  });
});
