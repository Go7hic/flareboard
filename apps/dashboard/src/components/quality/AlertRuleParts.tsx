import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { StatusBadge } from '../StatusBadge';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { t } from '../../lib/i18n';
import { FormSelect } from './FormSelect';

export type AlertChannel = 'record' | 'email' | 'webhook';

/** Channel + target fields shared by the error and log alert forms. */
export function AlertChannelFields({
  idPrefix,
  channel,
  target,
  onChannelChange,
  onTargetChange,
}: {
  idPrefix: string;
  channel: AlertChannel;
  target: string;
  onChannelChange: (channel: AlertChannel) => void;
  onTargetChange: (target: string) => void;
}) {
  return (
    <div className="q-form-row">
      <div className="q-field">
        <Label htmlFor={`${idPrefix}-channel`}>{t('alertRuleChannel')}</Label>
        <FormSelect
          id={`${idPrefix}-channel`}
          value={channel}
          onChange={(value) => onChannelChange(value as AlertChannel)}
          options={[
            { value: 'record', label: t('alertRuleChannel_record') },
            { value: 'email', label: t('alertRuleChannel_email') },
            { value: 'webhook', label: t('alertRuleChannel_webhook') },
          ]}
        />
      </div>
      {channel !== 'record' ? (
        <div className="q-field">
          <Label htmlFor={`${idPrefix}-target`}>{t('alertRuleTarget')}</Label>
          <Input
            id={`${idPrefix}-target`}
            value={target}
            placeholder={channel === 'email' ? 'ops@example.com' : 'https://hooks.example.com/alerts'}
            onChange={(event) => onTargetChange(event.target.value)}
          />
        </div>
      ) : (
        <div className="q-field" aria-hidden />
      )}
    </div>
  );
}

/**
 * One alert rule in a sheet list: name, condition, channel; an enable switch and a menu with
 * delete (and rule-specific items) for editors, a status badge for viewers.
 */
export function AlertRuleRow({
  name,
  enabled,
  condition,
  channel,
  target,
  canEdit,
  pending,
  onToggleEnabled,
  onDelete,
  menuItems,
}: {
  name: string;
  enabled: boolean;
  condition: ReactNode;
  channel: AlertChannel;
  target: string | null;
  canEdit: boolean;
  pending?: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onDelete: () => void;
  menuItems?: ReactNode;
}) {
  return (
    <li className="q-list-row q-rule-row">
      <div className="q-list-main">
        <span className="q-list-title">{name}</span>
        <span className="q-list-sub">{condition}</span>
        <span className="meta-line">
          <span>{t(`alertRuleChannel_${channel}`)}</span>
          {target ? (
            <span className="mono truncate-1" title={target}>
              {target}
            </span>
          ) : null}
        </span>
      </div>
      <div className="q-list-actions">
        {canEdit ? (
          <>
            <Switch
              checked={enabled}
              disabled={pending}
              onCheckedChange={(checked) => onToggleEnabled(checked)}
              aria-label={`${enabled ? t('disable') : t('enable')}: ${name}`}
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`${t('actions')}: ${name}`} />}
              >
                <MoreHorizontal aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {menuItems}
                {menuItems ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  {t('delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <StatusBadge tone={enabled ? 'success' : 'neutral'}>{enabled ? t('enabled') : t('disabled')}</StatusBadge>
        )}
      </div>
    </li>
  );
}
