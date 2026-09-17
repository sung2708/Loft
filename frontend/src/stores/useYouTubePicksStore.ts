"use client";
import { create } from "zustand";
export type YouTubePick = { id:string; video_id:string; title:string; channel:string; suggested_by:string; votes:number };
export const useYouTubePicksStore = create<{picks:YouTubePick[]; replace:(p:YouTubePick[])=>void; upsert:(p:YouTubePick)=>void; remove:(id:string)=>void; reset:()=>void}>((set)=>({picks:[],replace:(picks)=>set({picks}),upsert:(pick)=>set((s)=>({picks:s.picks.some((p)=>p.id===pick.id)?s.picks.map((p)=>p.id===pick.id?pick:p):[...s.picks,pick]})),remove:(id)=>set((s)=>({picks:s.picks.filter((p)=>p.id!==id)})),reset:()=>set({picks:[]})}));
