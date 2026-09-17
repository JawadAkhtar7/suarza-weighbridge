/**
 * Dashboard analytics (brief §9).
 *
 * Every figure excludes VOID records (brief §7.6) — a voided ticket is a truck
 * that never came back, and counting it as revenue would overstate the month.
 * The exclusion is applied once, in `revenueMatch`, rather than remembered at
 * each call site.
 */

import type { Analytics, WeighmentQuery } from '@suarza/shared';
import { DISPLAY_TIMEZONE } from '@suarza/shared';
import { WeighmentModel } from '../models/weighment.model.js';
import { buildFilter } from './weighment.service.js';

const TOP_N = 10;

export async function getAnalytics(query: WeighmentQuery): Promise<Analytics> {
  const filter = buildFilter(query);
  // The caller's own status filter is respected, but VOID can never sneak in.
  const revenueMatch = { ...filter, status: { $ne: 'VOID' } };

  const [totals, byVehicle, overTime, topCustomers, topCompanies, statusCounts] = await Promise.all(
    [
      WeighmentModel.aggregate([
        { $match: revenueMatch },
        {
          $group: {
            _id: null,
            total_weighments: { $sum: 1 },
            total_revenue: { $sum: '$amount_charged' },
            total_net_weight_kg: { $sum: '$net_weight_kg' },
          },
        },
      ]),

      WeighmentModel.aggregate([
        { $match: revenueMatch },
        {
          $group: {
            _id: '$vehicle_type',
            revenue: { $sum: '$amount_charged' },
            count: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
      ]),

      WeighmentModel.aggregate([
        { $match: revenueMatch },
        {
          $group: {
            // Bucketed by Pakistan local day, not UTC day — otherwise every
            // weighing before 5am PKT lands on the previous day's chart.
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$first_weight_at',
                timezone: DISPLAY_TIMEZONE,
              },
            },
            count: { $sum: 1 },
            revenue: { $sum: '$amount_charged' },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      WeighmentModel.aggregate([
        // Unnamed weighings are excluded for the same reason blank companies
        // are: they would group into one nameless bar pooling unrelated
        // trucks, and it would probably top the chart.
        { $match: { ...revenueMatch, customer_name: { $nin: ['', null] } } },
        {
          $group: {
            _id: '$customer_name',
            count: { $sum: 1 },
            revenue: { $sum: '$amount_charged' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: TOP_N },
      ]),

      WeighmentModel.aggregate([
        // Company is optional, and every customer who gave none would otherwise
        // be grouped into a single nameless bucket — unrelated individuals
        // added together, quite possibly topping the chart.
        { $match: { ...revenueMatch, customer_company: { $nin: ['', null] } } },
        {
          $group: {
            _id: '$customer_company',
            count: { $sum: 1 },
            revenue: { $sum: '$amount_charged' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: TOP_N },
      ]),

      WeighmentModel.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ],
  );

  const totalsRow = totals[0] ?? {
    total_weighments: 0,
    total_revenue: 0,
    total_net_weight_kg: 0,
  };

  const byStatus = new Map<string, number>(
    statusCounts.map((row: { _id: string; count: number }) => [row._id, row.count]),
  );

  return {
    total_weighments: totalsRow.total_weighments,
    completed_weighments: byStatus.get('COMPLETED') ?? 0,
    open_weighments: byStatus.get('OPEN') ?? 0,
    total_revenue: totalsRow.total_revenue,
    total_net_weight_kg: totalsRow.total_net_weight_kg,
    revenue_by_vehicle_type: byVehicle.map((row) => ({
      vehicle_type: row._id,
      revenue: row.revenue,
      count: row.count,
    })),
    weighments_over_time: overTime.map((row) => ({
      date: row._id,
      count: row.count,
      revenue: row.revenue,
    })),
    top_customers: topCustomers.map((row) => ({
      customer_name: row._id,
      count: row.count,
      revenue: row.revenue,
    })),
    top_companies: topCompanies.map((row) => ({
      customer_company: row._id,
      count: row.count,
      revenue: row.revenue,
    })),
  };
}
