create index news_source_feed_newest on public.news (source, published_at desc, (id::text) desc);
