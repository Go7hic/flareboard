import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { FormSelect } from './quality/FormSelect';
import { SettingSwitch } from './quality/SettingsCard';
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

/**
 * Replay recording options, grouped as sampling and privacy (hairline-separated sections of the
 * session replay settings card), plus a raw JSON editor for everything at once.
 */
export function ReplayConfigWizard({ enabled, config, onChange }: Props) {
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
    return <p className="q-field-hint">{t('replayWizardDisabledHint')}</p>;
  }

  return (
    <div className="q-replay">
      <div className="q-subsection">
        <h3 className="q-subsection-title">{t('replayWizardStep2')}</h3>
        <div className="q-field">
          <div className="q-range-head">
            <Label htmlFor="replay-sample-rate">{t('replaySampleRate')}</Label>
            <span className="q-range-value">{samplePct}%</span>
          </div>
          <input
            id="replay-sample-rate"
            type="range"
            min={0}
            max={100}
            step={1}
            value={samplePct}
            onChange={(e) => update({ sampleRate: parseInt(e.target.value, 10) / 100 })}
            className="q-range"
          />
          <p className="q-field-hint">{t('replaySampleRateHint')}</p>
        </div>
        <div className="q-field">
          <Label htmlFor="replay-min-duration">{t('replayMinDurationSetting')}</Label>
          <FormSelect
            id="replay-min-duration"
            className="q-select-narrow"
            value={String(config.minDurationSeconds ?? 0)}
            onChange={(value) => update({ minDurationSeconds: Number(value) })}
            options={MIN_DURATION_OPTIONS.map((seconds) => ({
              value: String(seconds),
              label: seconds ? t('replayMinDurationSeconds').replace('{n}', String(seconds)) : t('replayMinDurationNone'),
            }))}
          />
          <p className="q-field-hint">{t('replayMinDurationHint')}</p>
        </div>
        <SettingSwitch
          id="replay-capture-console"
          label={t('replayCaptureConsole')}
          hint={t('replayCaptureConsoleHint')}
          checked={config.captureConsole === true}
          onCheckedChange={(captureConsole) => update({ captureConsole })}
        />
        <SettingSwitch
          id="replay-capture-network"
          label={t('replayCaptureNetwork')}
          hint={t('replayCaptureNetworkHint')}
          checked={config.captureNetwork === true}
          onCheckedChange={(captureNetwork) => update({ captureNetwork })}
        />
      </div>

      <div className="q-subsection">
        <h3 className="q-subsection-title">{t('replayWizardStep3')}</h3>
        <SettingSwitch
          id="replay-mask-inputs"
          label={t('replayMaskInputs')}
          hint={t('replayMaskInputsHint')}
          checked={config.maskInputs !== false}
          onCheckedChange={(maskInputs) => update({ maskInputs })}
        />
        <SettingSwitch
          id="replay-mask-all-text"
          label={t('replayMaskAllText')}
          checked={config.maskAllText === true}
          onCheckedChange={(maskAllText) => update({ maskAllText })}
        />
        <div className="q-field">
          <Label htmlFor="replay-mask-selectors">{t('replayMaskSelectors')}</Label>
          <Textarea
            id="replay-mask-selectors"
            className="q-textarea-mono"
            rows={2}
            value={config.maskSelectors ?? ''}
            onChange={(e) => update({ maskSelectors: e.target.value })}
            placeholder=".customer-name, [data-pii]"
          />
          <p className="q-field-hint">{t('replayMaskSelectorsHint')}</p>
        </div>
        <div className="q-field">
          <Label htmlFor="replay-block-selectors">{t('replayBlockSelectors')}</Label>
          <Textarea
            id="replay-block-selectors"
            className="q-textarea-mono"
            rows={2}
            value={config.blockSelectors ?? ''}
            onChange={(e) => update({ blockSelectors: e.target.value })}
            placeholder=".secret, #payment-form, [data-private]"
          />
          <p className="q-field-hint">{t('replayBlockSelectorsHint')}</p>
        </div>
      </div>

      <div className="q-subsection">
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? t('replayHideAdvanced') : t('replayShowAdvanced')}
        </Button>
        {showAdvanced ? (
          <div className="q-field">
            <Label htmlFor="replay-config-json">{t('replayConfigJson')}</Label>
            <Textarea
              id="replay-config-json"
              className="q-textarea-mono"
              value={advancedJson}
              onChange={(e) => setAdvancedJson(e.target.value)}
              rows={6}
            />
            {jsonError ? <p className="q-form-error">{jsonError}</p> : null}
            <Button type="button" variant="outline" size="sm" onClick={applyAdvancedJson} className="self-start">
              {t('applyJson')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
