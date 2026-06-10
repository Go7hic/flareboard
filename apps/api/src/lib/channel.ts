/** SQLite CASE expression mapping paid click ids / medium to an ads platform label. */
export function paidAdsCaseSql(alias = 'e') {
  const a = alias;
  return `CASE
    WHEN ${a}.gclid IS NOT NULL THEN 'Google Ads'
    WHEN ${a}.msclkid IS NOT NULL THEN 'Microsoft Ads'
    WHEN ${a}.fbclid IS NOT NULL THEN 'Meta Ads'
    WHEN ${a}.ttclid IS NOT NULL THEN 'TikTok Ads'
    WHEN ${a}.twclid IS NOT NULL THEN 'X Ads'
    WHEN LOWER(COALESCE(${a}.utm_medium, '')) IN ('cpc', 'ppc', 'paid', 'paidsearch', 'cpm', 'display', 'banner')
      THEN COALESCE(NULLIF(${a}.utm_source, ''), ${a}.utm_medium, 'Paid')
    ELSE NULL
  END`;
}

/** SQLite CASE expression classifying a pageview into a traffic channel. */
export function channelCaseSql(alias = 'e') {
  const a = alias;
  return `CASE
    WHEN ${a}.gclid IS NOT NULL OR ${a}.msclkid IS NOT NULL
      OR LOWER(COALESCE(${a}.utm_medium, '')) IN ('cpc', 'ppc', 'paid', 'paidsearch', 'cpm', 'display', 'banner')
      THEN 'paid'
    WHEN LOWER(COALESCE(${a}.utm_medium, '')) IN ('email', 'e-mail', 'newsletter') THEN 'email'
    WHEN ${a}.fbclid IS NOT NULL OR ${a}.ttclid IS NOT NULL OR ${a}.twclid IS NOT NULL
      OR LOWER(COALESCE(${a}.utm_medium, '')) = 'social' THEN 'social'
    WHEN LOWER(COALESCE(${a}.utm_medium, '')) IN ('organic', 'seo') THEN 'organic'
    WHEN ${a}.referrer_domain IS NULL OR ${a}.referrer_domain = '' THEN 'direct'
    WHEN ${a}.referrer_domain LIKE '%google.%' OR ${a}.referrer_domain LIKE '%bing.%'
      OR ${a}.referrer_domain LIKE '%yahoo.%' OR ${a}.referrer_domain LIKE '%duckduckgo.%'
      OR ${a}.referrer_domain LIKE '%baidu.%' OR ${a}.referrer_domain LIKE '%yandex.%'
      OR ${a}.referrer_domain LIKE '%ecosia.%' THEN 'organic'
    WHEN ${a}.referrer_domain LIKE '%facebook.%' OR ${a}.referrer_domain LIKE '%instagram.%'
      OR ${a}.referrer_domain LIKE '%twitter.%' OR ${a}.referrer_domain = 'x.com'
      OR ${a}.referrer_domain LIKE '%linkedin.%' OR ${a}.referrer_domain LIKE '%reddit.%'
      OR ${a}.referrer_domain LIKE '%youtube.%' OR ${a}.referrer_domain LIKE '%tiktok.%'
      OR ${a}.referrer_domain LIKE '%pinterest.%' THEN 'social'
    ELSE 'referral'
  END`;
}
