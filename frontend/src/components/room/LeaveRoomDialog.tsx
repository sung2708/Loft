"use client";

import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/types";

export function LeaveRoomDialog({locale,name,pending,error,onClose,onLeave,onEnd}:{locale:Locale;name:string;pending:boolean;error:string|null;onClose:()=>void;onLeave:()=>void;onEnd:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [confirm,setConfirm]=useState(false);
 const l=(en:string,vi:string)=>locale==="vi"?vi:en;
 useEffect(()=>{
  const previous=document.activeElement;
  const element=dialog.current;element?.showModal();
  return()=>{element?.close();if(previous instanceof HTMLElement)previous.focus()};
 },[]);
 const button="btn-press rounded-[10px] border border-[var(--border-loft)] px-4 py-2.5 text-[13px] disabled:opacity-50";
 return <dialog ref={dialog} aria-labelledby="leave-room-title" aria-describedby="leave-room-description" onCancel={event=>{event.preventDefault();if(!pending)onClose()}} className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-[12px] border border-[var(--border-loft)] bg-[var(--bg-loft-card)] p-6 text-[var(--text-loft-primary)] shadow-2xl backdrop:bg-black/60">
  <h2 id="leave-room-title" className="text-base font-medium">{confirm?l("End room?","Kết thúc phòng?"):l("Leave room?","Rời phòng?")}</h2>
  <p id="leave-room-description" className="mt-3 text-[13px] text-[var(--text-loft-secondary)]">{confirm?l("Everyone will leave and the invite link will stop working. History and whiteboard are kept.","Mọi người sẽ rời phòng và link không còn dùng được. Lịch sử và bảng vẽ được giữ."):name}</p>
  {error&&<p role="alert" className="mt-3 text-[13px]">{error}</p>}
  <div className="mt-6 flex flex-col gap-2">
   {confirm?<>
    <button type="button" disabled={pending} className={button} style={{backgroundColor:"var(--text-loft-primary)",color:"var(--bg-loft-card)",transitionProperty:"transform, box-shadow, opacity"}} onClick={onEnd}>{pending?l("Ending…","Đang kết thúc…"):l("End room","Kết thúc phòng")}</button>
    <button type="button" disabled={pending} className={button} onClick={()=>setConfirm(false)}>{l("Back","Quay lại")}</button>
   </>:<>
    <button type="button" className={button} onClick={onLeave}>{l("Leave room","Rời phòng")}</button>
    <button type="button" className={button} onClick={()=>setConfirm(true)}>{l("End room","Kết thúc phòng")}</button>
    <button type="button" className={button} onClick={onClose}>{l("Cancel","Hủy")}</button>
   </>}
  </div>
 </dialog>;
}
