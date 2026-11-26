update public.news_sources
   set enabled = true,
       can_store_body = false,
       can_summarize = false,
       terms_note = 'Benzinga News API; headline and link ingestion enabled. Body storage and summarization remain off pending explicit permission.'
 where key = 'benzinga';
