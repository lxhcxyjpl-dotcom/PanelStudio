import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AIProviderConfig, AIProviderSettings } from "@panelstudio/contracts";
import { api, newKey, waitForJob } from "../api/client";
import { addressProblem, defaultProviderForm, endpointIdentity, inferProvider, knownVision, providerPresets, type ProviderPreset } from "../model/provider-form";
import { queryClient } from "../state/query";
import { patch, useWorkspaceFields } from "../state/store";
import { Shell } from "./DialogShell";
import { Button, Icon } from "./widgets";

export function SettingsDialog({ open, initialSection }: { open: boolean; initialSection: "general" | "ai" }) {
  const { t } = useTranslation();
  const [section, setSection] = useState(initialSection);
  useLayoutEffect(() => { if (open) setSection(initialSection); }, [open, initialSection]);
  return <Shell open={open} title={t("settings.title")} className="settings-dialog">
    <div className="settings-layout">
      <nav className="settings-nav" aria-label={t("connection.settingsSections")}>
        <Button action="settings-general" variant="quiet" aria-pressed={section === "general"} onClick={() => setSection("general")}><Icon name="sliders" />{t("connection.general")}</Button>
        <Button action="settings-ai" variant="quiet" aria-pressed={section === "ai"} onClick={() => setSection("ai")}><Icon name="spark" />{t("connection.title")}</Button>
      </nav>
      <div className="settings-content">{section === "general" ? <GeneralSettings /> : <ProviderConnection />}</div>
    </div>
  </Shell>;
}

function GeneralSettings() {
  const { t, i18n } = useTranslation();
  const state = useWorkspaceFields("theme", "locale", "motion", "reduceTransparency");
  return <section className="general-settings">
    <h3>{t("connection.general")}</h3>
    <label className="settings-row"><span>{t("settings.theme")}</span>
      <select aria-label={t("settings.theme")} value={state.theme} onChange={event => patch({ theme: event.target.value === "dark" ? "dark" : "light" })}>
        <option value="light">{t("settings.light")}</option><option value="dark">{t("settings.dark")}</option>
      </select>
    </label>
    <label className="settings-row"><span>{t("settings.language")}</span>
      <select aria-label={t("settings.language")} value={state.locale} onChange={event => { const locale = event.target.value === "en-US" ? "en-US" : "zh-CN"; patch({ locale }); void i18n.changeLanguage(locale); }}>
        <option value="zh-CN">简体中文</option><option value="en-US">English</option>
      </select>
    </label>
    <label className="settings-row"><span>{t("settings.reduceMotion")}</span>
      <select aria-label={t("settings.reduceMotion")} value={state.motion} onChange={event => patch({ motion: event.target.value === "on" || event.target.value === "off" ? event.target.value : "system" })}>
        <option value="system">{t("settings.motionSystem")}</option><option value="on">{t("settings.motionOn")}</option><option value="off">{t("settings.motionOff")}</option>
      </select>
    </label>
    <label className="settings-row"><span>{t("settings.reduceTransparency")}</span><input type="checkbox" checked={state.reduceTransparency} onChange={event => patch({ reduceTransparency: event.target.checked })} /></label>
  </section>;
}

function ProviderConnection() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: ["ai-provider"], queryFn: () => api.providerSettings() });
  const initialized = useRef(Boolean(settings.data));
  const [form, setForm] = useState<AIProviderConfig>(() => settings.data?.config ?? defaultProviderForm());
  const [preset, setPreset] = useState<ProviderPreset>(() => inferProvider(settings.data?.config?.baseUrl ?? ""));
  const [secret, setSecret] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [testedRevision, setTestedRevision] = useState<number | null>(null);
  const address = useRef<HTMLInputElement>(null);
  const modelInput = useRef<HTMLInputElement>(null);
  const secretInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (initialized.current || !settings.data) return;
    initialized.current = true;
    setForm(settings.data.config ?? defaultProviderForm());
    setPreset(inferProvider(settings.data.config?.baseUrl ?? ""));
  }, [settings.data]);
  const config: AIProviderConfig = { ...form, baseUrl: form.baseUrl.trim(), model: form.model.trim() };
  const identity = endpointIdentity(config.baseUrl);
  const sameEndpoint = identity !== null && identity === endpointIdentity(settings.data?.config?.baseUrl ?? "");
  const keepSecret = Boolean(sameEndpoint && settings.data?.hasSecret);
  const localOllama = preset === "ollama" && inferProvider(config.baseUrl) === "ollama" && config.allowLocalEndpoint;
  const urlError = addressProblem(config.baseUrl, config.allowLocalEndpoint);
  const keyError = /[\r\n]/u.test(secret.trim()) ? "connection.keyInvalid" : !secret.trim() && !keepSecret && !localOllama ? "connection.keyRequired" : null;
  const dirty = secret.length > 0 || JSON.stringify(config) !== JSON.stringify(settings.data?.config);
  const verified = !dirty && testedRevision !== null && testedRevision === settings.data?.configRevision;
  const fixedVision = knownVision(config.baseUrl, config.model);
  function edit(next: AIProviderConfig) { initialized.current = true; setForm(next); setMessage(null); }
  function choose(value: ProviderPreset) {
    const next = providerPresets[value];
    setPreset(value); setSecret(""); setAttempted(false);
    edit({ adapter: "openai-compatible", baseUrl: next.url, model: next.model,
      capabilities: { imageInput: next.imageInput, structuredOutput: "json_object" }, allowLocalEndpoint: next.local });
  }
  function problemText(value: string): string {
    if (/HTTP (401|403)/u.test(value)) return t("connection.authFailed");
    if (/HTTP 404/u.test(value)) return t("connection.notFound");
    if (/HTTP 429/u.test(value)) return t("connection.rateLimited");
    return value;
  }
  async function persist(test: boolean) {
    setAttempted(true); setMessage(null);
    if (urlError) { address.current?.focus(); return; }
    if (!config.model) { modelInput.current?.focus(); return; }
    if (keyError) { secretInput.current?.focus(); return; }
    setBusy(test ? "test" : "save");
    try {
      let saved: AIProviderSettings | undefined = settings.data;
      if (dirty || !keepSecret) {
        const key = secret.trim() || (!keepSecret && localOllama ? "ollama" : undefined);
        saved = await api.saveConnection({ config, ...(key ? { secret: key } : {}) }, newKey());
        queryClient.setQueryData(["ai-provider"], saved);
        setSecret(""); setForm(config);
      }
      if (!test) { setMessage({ kind: "success", text: t("connection.saved") }); return; }
      const accepted = await api.testProvider(newKey());
      const job = await waitForJob(accepted.jobId);
      if (job.status === "succeeded" && job.result && "latencyMs" in job.result) {
        setTestedRevision(saved?.configRevision ?? null);
        setMessage({ kind: "success", text: t("ai.testOk", { latency: job.result.latencyMs }) });
      } else {
        setTestedRevision(null);
        setMessage({ kind: "error", text: problemText(job.status === "failed" ? job.error?.message ?? t("ai.jobFailed") : t("ai.jobFailed")) });
      }
    } catch (error) { setTestedRevision(null); setMessage({ kind: "error", text: problemText(error instanceof Error ? error.message : t("ai.jobFailed")) }); }
    finally { setBusy(null); }
  }
  async function removeSecret() {
    setBusy("remove"); setMessage(null);
    try {
      await api.deleteSecret(newKey()); setSecret(""); setTestedRevision(null);
      await queryClient.invalidateQueries({ queryKey: ["ai-provider"] });
      setMessage({ kind: "success", text: t("settings.noSecret") });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : t("ai.jobFailed") }); }
    finally { setBusy(null); }
  }
  return <section className="provider-connection" data-testid="ai-settings">
    <div className="connection-heading"><div><h3>{t("connection.heading")}</h3><p>{t("connection.compatibility")}</p></div>
      <span className="connection-badge" data-verified={verified}>{t(verified ? "connection.verified" : keepSecret && !dirty ? "connection.configured" : "connection.notConnected")}</span>
    </div>
    <form noValidate onSubmit={event => { event.preventDefault(); if (!busy) void persist(false); }}>
      <fieldset disabled={Boolean(busy) || settings.isPending} className="connection-fields">
        <label className="field"><span>{t("connection.service")}</span><select aria-label={t("connection.service")} data-testid="ai-service" value={preset} onChange={event => choose(event.target.value as ProviderPreset)}>
          <option value="custom">{t("connection.custom")}</option><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option>
          <option value="openrouter">OpenRouter</option><option value="ollama">Ollama</option>
        </select></label>
        <label className="field"><span>{t("connection.address")}</span>
          <input ref={address} aria-label={t("connection.address")} data-testid="ai-base-url" value={form.baseUrl} placeholder="https://api.example.com/v1" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            aria-invalid={Boolean(urlError && (attempted || form.baseUrl.trim()))} aria-describedby="connection-address-hint"
            onChange={event => { const baseUrl = event.target.value; edit({ ...form, baseUrl, capabilities: { ...form.capabilities, imageInput: knownVision(baseUrl, form.model) ?? false } }); }} />
          <small id="connection-address-hint" className={urlError && (attempted || form.baseUrl.trim()) ? "field-error" : "field-hint"}>
            {t(urlError && (attempted || form.baseUrl.trim()) ? urlError : "connection.addressHint")}
          </small>
        </label>
        <label className="field"><span>{t("settings.model")}</span>
          <input ref={modelInput} aria-label={t("settings.model")} data-testid="ai-model" value={form.model} autoCapitalize="none" spellCheck={false} placeholder={t("connection.modelPlaceholder")}
            list={inferProvider(form.baseUrl) === "deepseek" ? "deepseek-models" : undefined} aria-invalid={attempted && !config.model}
            onChange={event => edit({ ...form, model: event.target.value, capabilities: { ...form.capabilities, imageInput: knownVision(form.baseUrl, event.target.value) ?? false } })} />
          {inferProvider(form.baseUrl) === "deepseek" && <datalist id="deepseek-models"><option value="deepseek-flash" /><option value="deepseek-v4-pro" /></datalist>}
          {attempted && !config.model && <small className="field-error">{t("connection.modelRequired")}</small>}
        </label>
        <label className="field"><span className="secret-label">{t("connection.key")}<small data-testid="ai-secret-state">{keepSecret ? t("settings.hasSecret") : ""}</small></span>
          <input ref={secretInput} aria-label={t("connection.key")} data-testid="ai-secret" type="password" autoComplete="new-password" value={secret}
            placeholder={t(keepSecret ? "connection.keepKey" : localOllama ? "connection.ollamaKey" : "connection.keyPlaceholder")}
            aria-invalid={attempted && Boolean(keyError)} onChange={event => { initialized.current = true; setSecret(event.target.value); setMessage(null); }} />
          {attempted && keyError ? <small className="field-error">{t(keyError)}</small> : <small className="field-hint">{t(settings.data?.hasSecret && !sameEndpoint ? "connection.newEndpointKey" : "connection.keyHint")}</small>}
        </label>
        <label className="vision-setting"><span><strong>{t("connection.vision")}</strong><small>{t(fixedVision === false ? "connection.noVision" : "connection.visionHint")}</small></span>
          <input aria-label={t("connection.vision")} data-testid="ai-image" type="checkbox" checked={form.capabilities.imageInput} disabled={fixedVision === false}
            onChange={event => edit({ ...form, capabilities: { ...form.capabilities, imageInput: event.target.checked } })} />
        </label>
        <details className="connection-advanced"><summary>{t("connection.advanced")}<Icon name="chevron" /></summary>
          <div><label className="field"><span>{t("settings.structured")}</span>
            <select data-testid="ai-structured" value={form.capabilities.structuredOutput} onChange={event => edit({ ...form, capabilities: { ...form.capabilities, structuredOutput: event.target.value as AIProviderConfig["capabilities"]["structuredOutput"] } })}>
              <option value="json_object">JSON</option><option value="json_schema">JSON Schema</option><option value="text_json">{t("connection.textFormat")}</option>
            </select></label>
            <label className="check"><input data-testid="ai-local" type="checkbox" checked={form.allowLocalEndpoint} onChange={event => edit({ ...form, allowLocalEndpoint: event.target.checked })} />{t("connection.local")}</label>
            <p className="field-hint">{t("connection.localHint")}</p>
            {settings.data?.hasSecret && <Button action="delete-secret" variant="quiet" onClick={() => void removeSecret()}>{t("settings.deleteSecret")}</Button>}
          </div>
        </details>
      </fieldset>
      {settings.isError && <p className="field-error" role="alert">{t("ai.connectionError")}</p>}
      <div className="connection-footer">
        {message && <p data-testid="ai-provider-status" className={"connection-feedback " + message.kind} role="status"><Icon name={message.kind === "success" ? "check" : "close"} />{message.text}</p>}
        {busy && <p role="status">{t(busy === "test" ? "connection.testing" : "connection.saving")}</p>}
        <div className="connection-actions">
          <Button action="save-connection" type="submit" variant="quiet" disabled={Boolean(busy) || settings.isPending || (!dirty && keepSecret)}>{t("connection.save")}</Button>
          <Button action="test-provider" variant="primary" disabled={Boolean(busy) || settings.isPending} onClick={() => void persist(true)}><Icon name="check" />{t(dirty || !keepSecret ? "connection.saveTest" : "ai.test")}</Button>
        </div>
        <p className="connection-test-note">{t("connection.testHint")}</p>
      </div>
    </form>
  </section>;
}
