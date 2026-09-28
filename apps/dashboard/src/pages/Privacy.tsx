import { LegalPage } from '../components/landing/LegalPage';
import { privacyEn } from './legal/privacy.en';
import { privacyZh } from './legal/privacy.zh';

export default function PrivacyPage() {
  return <LegalPage docs={{ en: privacyEn, 'zh-CN': privacyZh }} />;
}
