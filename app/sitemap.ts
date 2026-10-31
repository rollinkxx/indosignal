import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap { const lastModified = new Date(); return [{ url: SITE_ORIGIN, lastModified }, { url: `${SITE_ORIGIN}/performa`, lastModified }, { url: `${SITE_ORIGIN}/strategi/trend-following`, lastModified }, { url: `${SITE_ORIGIN}/edukasi/data-live-indodax`, lastModified }]; }
