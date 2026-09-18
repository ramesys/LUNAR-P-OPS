import type { Site } from "@clps/api-client";
import type { ChangeEvent, JSX, SyntheticEvent } from "react";
import { formatLatLon } from "../lib/format.ts";
import {
  MAX_EARTH_CLEARANCE_DEG,
  MAX_SITES,
  STEP_OPTIONS,
  toggleSite,
  type ScenarioForm as Form,
} from "../lib/scenario.ts";
import { InfoTip } from "./InfoTip.tsx";

interface ScenarioFormProps {
  sites: readonly Site[];
  form: Form;
  errors: readonly string[];
  busy: boolean;
  onChange: (form: Form) => void;
  onSubmit: () => void;
}

export function ScenarioForm({
  sites,
  form,
  errors,
  busy,
  onChange,
  onSubmit,
}: ScenarioFormProps): JSX.Element {
  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="card scenario-form" onSubmit={handleSubmit} aria-label="Scenario">
      <fieldset className="site-picker">
        <legend>
          Sites to compare <span className="muted">(2 to {MAX_SITES.toString()})</span>
        </legend>
        {sites.map((site: Site): JSX.Element => {
          const checked: boolean = form.siteIds.includes(site.id);
          const disabled: boolean = !checked && form.siteIds.length >= MAX_SITES;
          return (
            <label key={site.id} className={disabled ? "site-option disabled" : "site-option"}>
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(): void => {
                  onChange({ ...form, siteIds: toggleSite(form.siteIds, site.id) });
                }}
              />
              <span className="site-name">{site.name}</span>
              {site.origin === "sample" && <span className="chip">sample</span>}
              {!site.terrain_available && (
                <span className="chip chip-muted" title="Terrain data not downloaded: a flat horizon is used">
                  flat only
                </span>
              )}
              <span className="muted coords">
                {formatLatLon(site.latitude_deg, site.longitude_deg)}
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="form-row">
        <label>
          From (UTC)
          <input
            type="date"
            value={form.startDate}
            required
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              onChange({ ...form, startDate: event.target.value });
            }}
          />
        </label>
        <label>
          To (UTC, inclusive)
          <input
            type="date"
            value={form.endDate}
            required
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              onChange({ ...form, endDate: event.target.value });
            }}
          />
        </label>
        <label>
          <span>
            Step <InfoTip text="Time between samples. Window start and end times are accurate to ± one step." />
          </span>
          <select
            value={form.stepMinutes}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
              onChange({ ...form, stepMinutes: Number(event.target.value) });
            }}
          >
            {STEP_OPTIONS.map(
              (option: { minutes: number; label: string }): JSX.Element => (
                <option key={option.minutes} value={option.minutes}>
                  {option.label}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          <span>
            Horizon{" "}
            <InfoTip text="Terrain uses NASA LOLA elevation data to find which hills and crater walls block the Sun and the Earth. Flat ignores the terrain (useful to see how much it matters)." />
          </span>
          <select
            value={form.horizon}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
              onChange({ ...form, horizon: event.target.value === "flat" ? "flat" : "terrain" });
            }}
          >
            <option value="terrain">Terrain (LOLA)</option>
            <option value="flat">Flat</option>
          </select>
        </label>
        <label>
          <span>
            Min. Earth elevation (°){" "}
            <InfoTip text="Direct-to-Earth needs the Earth at least this many degrees above the horizon (antenna clearance). 0° means just above it." />
          </span>
          <input
            type="number"
            min={0}
            max={MAX_EARTH_CLEARANCE_DEG}
            step={0.5}
            value={form.earthMinClearanceDeg}
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              onChange({ ...form, earthMinClearanceDeg: Number(event.target.value) });
            }}
          />
        </label>
        <label>
          <span>
            Observer height (m){" "}
            <InfoTip text="Height of the solar panel or antenna above the ground. A higher viewpoint sees over nearby terrain; with a flat horizon its effect is negligible." />
          </span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={form.observerHeightM}
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              onChange({ ...form, observerHeightM: Number(event.target.value) });
            }}
          />
        </label>
        <button type="submit" disabled={busy || errors.length > 0}>
          {busy ? "Computing…" : "Compare sites"}
        </button>
      </div>

      {errors.length > 0 && (
        <ul className="form-errors" role="alert">
          {errors.map((error: string): JSX.Element => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
