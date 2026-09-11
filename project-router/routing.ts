/**
 * Types the router's storage and return-watch surfaces are written against.
 *
 * This file also held `DestinationRouter`, the implementation that created a destination session
 * per route, revalidated it, wrote a receipt and delivered the request as a prompt. `project_route`
 * no longer does any of that -- it confirms the selected revision in the one persistent giver and
 * returns `createdSessions: 0` -- and nothing constructed the class any more.
 *
 * It is deleted rather than left dead because it is the thing the measurement was of: every
 * recorded `project_route` call on this ledger belongs to it (median 6.73s, p95 27.29s over the 13
 * single-call executes; the slowest, 27.29s, created and prompted three destination conversations).
 * The current tool measures 70ms in a driven run. Keeping the old path around only invites the old
 * number to be re-measured and re-attributed to code that no longer runs.
 */
import type { Target } from './resolution'

export type Storage = { get(key: string): Promise<any>; set(key: string, value: any): Promise<void> }
export type SessionHost = { create(input: any): Promise<any>; get(input: any): Promise<any>; prompt(input: any): Promise<any> }
export type RouteReceipt = { key: string; target: Target; hubSessionID: string; destinationSessionID?: string; state: 'preparing' | 'bound' | 'delivered' | 'unknown' | 'cancelled'; revision: number; reason?: string }
