import React from 'react';

export default function FailureBanner({ trend }) {
  if (!trend || trend.last_hour === 0) return null;

  return (
    <div className="failure-banner">
      <span className="failure-icon">!</span>
      <span>
        {trend.last_hour} failure{trend.last_hour !== 1 ? 's' : ''} in the last hour
        {trend.last_day > trend.last_hour && ` (${trend.last_day} in 24h)`}
        {trend.total > trend.last_day && ` — ${trend.total} total`}
      </span>
    </div>
  );
}
