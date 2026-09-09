import {test,expect} from "bun:test"
import {boardProject,projectQuests} from "../quest/board-project"
test("shared ledger records are filtered by explicit ownership, with All projects opt-in",()=>{const rows:any[]=[{id:"a",project:{id:"one"}},{id:"b",project:{id:"two"}},{id:"legacy"}];expect(projectQuests(rows,"one").map(q=>q.id)).toEqual(["a"]);expect(projectQuests(rows,undefined)).toEqual([]);expect(projectQuests(rows,"one",true)).toHaveLength(3);expect(boardProject(undefined).error).toContain("location unavailable")})
