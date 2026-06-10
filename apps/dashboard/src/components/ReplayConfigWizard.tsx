import { useEffect, useState } from 'react';
import { SegmentTabs } from './SegmentTabs';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { t } from '../lib/i18n';

export type ReplayConfig = {
  sampleRate?: number;
  maskInputs?: boolean;
  blockSelectors?: string;
};

type Props = {
  enabled: boolean;
  config: ReplayConfig;
  onChange: (config: ReplayConfig) => void;
};

function parseConfig(raw: Record<string, unknown> | undefined): ReplayConfig {
  if (!raw) return { sampleRate: 1, maskInputs: true, blockSelectors: '' };
  const rate = typeof raw.sampleRate === 'number' ? raw.sampleRate : 1;
  return {
    sampleRate: Math.min(1, Math.max(0, rate)),
    maskInputs: raw.maskInputs !== false,
    blockSelectors: typeof raw.blockSelectors === 'string' ? raw.blockSelectors : '',
  };
}

export function replayConfigFromJson(raw: Record<string, unknown> | undefined): ReplayConfig {
  return parseConfig(raw);
}

export function replayConfigToJson(config: ReplayConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sampleRate: Math.round((config.sampleRate ?? 1) * 1000) / 1000,
    maskInputs: config.maskInputs !== false,
  };
  const selectors = (config.blockSelectors ?? '').trim();
  if (selectors) out.blockSelectors = selectors;
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
      <p className="text-muted" style={{ fontSize: '0.875rem' }}>
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
            style={{ width: '100%', maxWidth: '24rem' }}
          />
          <p className="text-muted" style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>
            {t('replaySampleRateHint')}
          </p>
        </div>
      ) : null}

      {step === 2 ? (
        <>
          <label className="field" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={config.maskInputs !== false}
              onChange={(e) => update({ maskInputs: e.target.checked })}
            />
            {t('replayMaskInputs')}
          </label>
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
            <p className="text-muted" style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>
              {t('replayBlockSelectorsHint')}
            </p>
          </div>
        </>
      ) : null}

      <div style={{ marginTop: '1rem' }}>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? t('replayHideAdvanced') : t('replayShowAdvanced')}
        </Button>
        {showAdvanced ? (
          <div className="field" style={{ marginTop: '0.5rem' }}>
            <Label>{t('replayConfigJson')}</Label>
            <Textarea
              className="textarea-mono"
              value={advancedJson}
              onChange={(e) => setAdvancedJson(e.target.value)}
              rows={6}
            />
            {jsonError ? <p className="text-danger">{jsonError}</p> : null}
            <Button type="button" variant="secondary" size="sm" onClick={applyAdvancedJson} style={{ marginTop: '0.5rem' }}>
              {t('applyJson')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
