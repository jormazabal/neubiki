import { requestJson } from "./client";
import type { ProtonNode } from "../../types/protonWorkspace";

export type MeetingPublicationSource = {
  sessionId: string;
  sourceRevision: string;
  summaryRevision?: string;
  title: string;
};

export type MeetingPublicationTarget = Omit<MeetingPublicationSource, "title"> & {
  accountId: string;
  rootId: string;
  parentId: string;
  name: string;
};

export type MeetingPublicationOutcome = { state: "unknown" } | { state: "conflict" } | { state: "confirmed"; node: ProtonNode };
export type MeetingPublicationReview = MeetingPublicationOutcome | { state: "review"; digest: string; markdown: string; partial: boolean };

function request<T>(action: string, body: object) {
  return requestJson<T>(`/api/proton/workspace/${action}`, {
    method: "POST", body: JSON.stringify(body), timeoutMs: 180_000,
  });
}

export const reviewMeetingPublication = (body: MeetingPublicationTarget) =>
  request<MeetingPublicationReview>("meeting-publish-review", body);

export const publishMeeting = (body: MeetingPublicationTarget, digest: string) =>
  request<MeetingPublicationOutcome>("meeting-publish", { ...body, digest });

export const checkMeetingPublication = (body: MeetingPublicationTarget) =>
  request<MeetingPublicationOutcome>("meeting-publish-check", body);
