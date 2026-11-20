-- Remember the Stripe customer behind each order so buyers can manage subscriptions.
alter table orders add column if not exists customer text;
create index if not exists orders_customer on orders(customer);
