import { QuestTracker } from "./tracker"
import { QuestStore } from "./store"
import { questRoot } from "./root"
const trackers=new Map<string,QuestTracker>()
/** Reuse the canonical exact-session index; shared storage never becomes project identity. */
export function questSessionContext(sessionID:string,root=questRoot()) {let tracker=trackers.get(root);if(!tracker){tracker=new QuestTracker(new QuestStore(root));trackers.set(root,tracker)}const ref=tracker.sessionIndex().get(sessionID)??tracker.sessionIndex(0).get(sessionID);return ref?{questID:ref.questID,parentID:ref.session.parentID??ref.session.parentSessionID,runID:ref.session.runID,reasoning:ref.session.reasoningEffort,harness:ref.session.runtime??ref.session.harness}:undefined}
