import { LegalPage } from '../components/landing/LegalPage';
import { termsEn } from './legal/terms.en';
import { termsZh } from './legal/terms.zh';

export default function TermsPage() {
  return <LegalPage docs={{ en: termsEn, 'zh-CN': termsZh }} />;
}
