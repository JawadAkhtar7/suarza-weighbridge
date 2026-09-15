/** Holds the charts' space while their bundle loads, so nothing jumps. */

import { Card, CardContent, CardHeader, Skeleton } from '@suarza/ui';

export function ChartsFallback() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {[0, 1].map((index) => (
        <Card key={index}>
          <CardHeader className="pb-2">
            <Skeleton className="h-5 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[240px] w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
