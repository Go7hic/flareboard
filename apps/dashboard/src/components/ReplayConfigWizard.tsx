import { useEffect, useState } from 'react';
import { SegmentTabs } from './SegmentTabs';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { t } from '../lib/i18n';

/** Saved as website.replay_config; ingest normalizes it for recorder.js (replaySettings). */
export type ReplayConfig = {
  sampleRate?: number;
  /** Seconds a visit must last before anything is sent (0 = record everything). */
  minDurationSeconds?: number;
  maskInputs?: boolean;
  maskAllText?: boolean;
  maskSelectors?: string;
  blockSelectors?: string;
  captureConsole?: boolean;
  captureNetwork?: boolean;
};

const MIN_DURATION_OPTIONS = [0, 2, 5, 10, 30] as const;

type Props = {
  enabled: boolean;
  config: ReplayConfig;
  onChange: (config: ReplayConfig) => void;
};

function parseConfig(raw: Record<string, unknown> | undefined): ReplayConfig {
  const cfg = raw ?? {};
  const rate = typeof cfg.sampleRate === 'number' ? cfg.sampleRate : 1;
  const minSeconds = typeof cfg.minDurationSeconds === 'number' ? cfg.minDurationSeconds : 0;
  return {
    sampleRate: Math.min(1, Math.max(0, rate)),
    minDurationSeconds: Math.min(60, Math.max(0, minSeconds)),
    maskInputs: cfg.maskInputs !== false,
    maskAllText: cfg.maskAllText === true,
    maskSelectors: typeof cfg.maskSelectors === 'string' ? cfg.maskSelectors : '',
    blockSelectors: typeof cfg.blockSelectors === 'string' ? cfg.blockSelectors : '',
    captureConsole: cfg.captureConsole === true,
    captureNetwork: cfg.captureNetwork === true,
  };
}

export function replayConfigFromJson(raw: Record<string, unknown> | undefined): ReplayConfig {
  return parseConfig(raw);
}

export function replayConfigToJson(config: ReplayConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sampleRate: Math.round((config.sampleRate ?? 1) * 1000) / 1000,
    maskInputs: config.maskInputs !== false,
    maskAllText: config.maskAllText === true,
    captureConsole: config.captureConsole === true,
    captureNetwork: config.captureNetwork === true,
  };
  if (config.minDurationSeconds) out.minDurationSeconds = config.minDurationSeconds;
  const blocks = (config.blockSelectors ?? '').trim();
  if (blocks) out.blockSelectors = blocks;
  const masks = (config.maskSelectors ?? '').trim();
  if (masks) out.maskSelectors = masks;
  return out;
}

export function ReplayConfigWizard({ enabled, config, onChange }: Props) {
  const [step, setStep] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedJson, setAdvancedJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const samplePct = Math.round((config.sampleRate ?? 1) * 100);

  useEffect(() => {
    setAdvancedJson(JSON.stringify(replayConfigToJson(config), null, 2));
  }, [config]);

  function update(partial: Partial<ReplayConfig>) {
    onChange({ ...config, ...partial });
  }

  function applyAdvancedJson() {
    try {
      const parsed = JSON.parse(advancedJson) as Record<string, unknown>;
      onChange(parseConfig(parsed));
      setJsonError(null);
    } catch {
      setJsonError(t('invalidReplayJson'));
    }
  }

  if (!enabled) {
    return (
      <p className="section-lead">
        {t('replayWizardDisabledHint')}
      </p>
    );
  }

  const steps = [t('replayWizardStep1'), t('replayWizardStep2'), t('replayWizardStep3')];

  return (
    <div className="replay-wizard">
      <SegmentTabs
        className="replay-wizard-steps"
        tabs={steps.map((label, i) => ({ id: String(i), label: `${i + 1}. ${label}` }))}
        value={String(step)}
        onChange={(id) => setStep(Number(id))}
        aria-label={t('replayWizardStep1')}
      />

      {step === 0 ? (
        <p className="section-lead">{t('replayWizardStep1Lead')}</p>
      ) : null}

      {step === 1 ? (
        <div className="field">
          <Label htmlFor="replay-sample-rate">
            {t('replaySampleRate')}: {samplePct}%
          </Label>
          <input
            id="replay-sample-rate"
            type="range"
            min={0}
            max={100}
            step={1}
            value={samplePct}
            onChange={(e) => update({ sampleRate: parseInt(e.target.value, 10) / 100 })}
            className="w-full max-w-96"
          />
          <p className="field-hint">
            {t('replaySampleRateHint')}
          </p>
          <Label htmlFor="replay-min-duration" className="mt-4">
            {t('replayMinDurationSetting')}
          </Label>
          <select
            id="replay-min-duration"
            className="select max-w-96"
            value={String(config.minDurationSeconds ?? 0)}
            onChange={(e) => update({ minDurationSeconds: Number(e.target.value) })}
          >
            {MIN_DURATION_OPTIONS.map((seconds) => (
              <option key={seconds} value={String(seconds)}>
                {seconds ? t('replayMinDurationSeconds').replace('{n}', String(seconds)) : t('replayMinDurationNone')}
              </option>
            ))}
          </select>
          <p className="field-hint">{t('replayMinDurationHint')}</p>
          <label className="field field-inline mt-4">
            <input
              type="checkbox"
              checked={config.captureConsole === true}
              onChange={(e) => update({ captureConsole: e.target.checked })}
            />
            {t('replayCaptureConsole')}
          </label>
          <p className="field-hint">{t('replayCaptureConsoleHint')}</p>
          <label className="field field-inline">
            <input
              type="checkbox"
              checked={config.captureNetwork === true}
              onChange={(e) => update({ captureNetwork: e.target.checked })}
            />
            {t('replayCaptureNetwork')}
          </label>
          <p className="field-hint">{t('replayCaptureNetworkHint')}</p>
        </div>
      ) : null}

      {step === 2 ? (
        <>
          <label className="field field-inline">
            <input
              type="checkbox"
              checked={config.maskInputs !== false}
              onChange={(e) => update({ maskInputs: e.target.checked })}
            />
            {t('replayMaskInputs')}
          </label>
          <p className="field-hint">{t('replayMaskInputsHint')}</p>
          <label className="field field-inline">
            <input
              type="checkbox"
              checked={config.maskAllText === true}
              onChange={(e) => update({ maskAllText: e.target.checked })}
            />
            {t('replayMaskAllText')}
          </label>
          <div className="field">
            <Label htmlFor="replay-mask-selectors">{t('replayMaskSelectors')}</Label>
            <Textarea
              id="replay-mask-selectors"
              className="textarea-mono"
              rows={3}
              value={config.maskSelectors ?? ''}
              onChange={(e) => update({ maskSelectors: e.target.value })}
              placeholder=".customer-name, [data-pii]"
            />
            <p className="field-hint">{t('replayMaskSelectorsHint')}</p>
          </div>
          <div className="field">
            <Label htmlFor="replay-block-selectors">{t('replayBlockSelectors')}</Label>
            <Textarea
              id="replay-block-selectors"
              className="textarea-mono"
              rows={4}
              value={config.blockSelectors ?? ''}
              onChange={(e) => update({ blockSelectors: e.target.value })}
              placeholder=".secret, #payment-form, [data-private]"
            />
            <p className="field-hint">
              {t('replayBlockSelectorsHint')}
            </p>
          </div>
        </>
      ) : null}

      <div className="mt-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? t('replayHideAdvanced') : t('replayShowAdvanced')}
        </Button>
        {showAdvanced ? (
          <div className="field mt-2">
            <Label>{t('replayConfigJson')}</Label>
            <Textarea
              className="textarea-mono"
              value={advancedJson}
              onChange={(e) => setAdvancedJson(e.target.value)}
              rows={6}
            />
            {jsonError ? <p className="text-danger">{jsonError}</p> : null}
            <Button type="button" variant="secondary" size="sm" onClick={applyAdvancedJson} className="mt-2 self-start">
              {t('applyJson')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
