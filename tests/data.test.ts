import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { attendanceMonths, listChildren, loadAttendance, loadAttendanceYears, loadClassTeachers, readFamilyAccess, type FamilyAccess, type FamilyChild } from '../src/data/family';
import { getFamilyExamSchedule, loadFamilyNotificationInbox, loadFamilyNotificationUnreadCount, markAllFamilyNotificationsRead, markFamilyNotificationRead, type FamilyNotification } from '../src/data/notifications';

const id = (n: number) => `41000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = '2026-11-06T15:00:00.123456+00:00';
const access: FamilyAccess = { userId: id(1), schoolId: id(2), name: 'QA parent', roles: ['parent'] };
const child: FamilyChild = { id: id(3), school_id: id(2), admission_no: 'QA-001', first_name: 'QA child', middle_name: null, last_name: null, roll_no: '1', status: 'active' };
type Reply = { data: unknown; error: {code?: string; message?: string} | null; count?: number | null };
type Query = { table: string; filters: [string, unknown][]; selection: string; single: boolean; range?: [number, number]; abort?: AbortSignal };
function mockClient() {
  const queries: Query[] = [];
  const auth = vi.fn().mockResolvedValue({data:{user:{id:id(1),is_anonymous:false,email_confirmed_at:stamp}},error:null});
  let resolver = (q: Query): Reply => {
    if (q.table === 'profiles') return { data:{id:id(1),school_id:id(2),full_name:'QA parent',is_active:true},error:null };
    if (q.table === 'user_roles') return { data:[{user_id:id(1),school_id:id(2),role:'parent'}],error:null };
    if (q.table === 'parents') return {data:{id:id(4),school_id:id(2),profile_id:id(1)},error:null};
    if (q.table === 'student_parents') return {data:[{student_id:id(3)}],count:1,error:null};
    if (q.table === 'students') return {data:q.single?{...child,profile_id:id(1)}:[child],error:null};
    if (q.table === 'attendance') return {data:[{attendance_date:'2026-11-05',academic_year_id:id(5),status:'absent',student_id:id(3),school_id:id(2)}],count:1,error:null};
    throw Error(`Unexpected table ${q.table}`);
  };
  const rpc = vi.fn((name:string) => {
    const reply:Reply = {data:name==='get_family_notification_unread_count'?0:null,error:null};
    return Object.assign(Promise.resolve(reply),{abortSignal:vi.fn().mockResolvedValue(reply)});
  });
  const from = vi.fn((table:string)=>{
    const q:Query={table,filters:[],selection:'',single:false};queries.push(q);
    const builder = {
      select(columns:string){q.selection=columns;return builder;},
      eq(column:string,value:unknown){q.filters.push([column,value]);return builder;},
      gte(column:string,value:unknown){q.filters.push([`gte:${column}`,value]);return builder;},
      lte(column:string,value:unknown){q.filters.push([`lte:${column}`,value]);return builder;},
      in(column:string,value:unknown){q.filters.push([column,value]);return builder;},
      order(){return builder;},limit(){return builder;},
      range(first:number,last:number){q.range=[first,last];return builder;},
      maybeSingle(){q.single=true;return builder;},
      abortSignal(signal:AbortSignal){q.abort=signal;return builder;},
      then(resolve:(value:Reply)=>unknown,reject:(error:unknown)=>unknown){return Promise.resolve().then(()=>resolver(q)).then(resolve,reject);},
    };
    return builder;
  });
  return { client:{auth:{getUser:auth},from,rpc} as unknown as SupabaseClient, auth, from, rpc, queries,
    patch: (table:string,reply:Reply) => {const previous=resolver;resolver=q=>q.table===table?reply:previous(q);},
  };
}

describe('mobile verified family access and retained attendance',()=>{
  it('derives actual same-school family roles and checks native session through existing RPC',async()=>{
    const saved=mockClient();expect(await readFamilyAccess(saved.client)).toEqual(access);
    expect(saved.rpc).toHaveBeenCalledWith('get_family_notification_unread_count',{p_role:'parent'});
    expect(saved.queries.find(q=>q.table==='user_roles')?.filters).toEqual([['user_id',id(1)],['school_id',id(2)],['role',['parent','student']]]);
  });
  it('does not infer roles from editable Auth metadata or permit an unverified/anonymous account',async()=>{
    for(const patch of [{is_anonymous:true},{email_confirmed_at:undefined},{id:'not-a-uuid'}]){
      const saved=mockClient();saved.auth.mockResolvedValue({data:{user:{id:id(1),is_anonymous:false,email_confirmed_at:stamp,user_metadata:{role:'parent'},...patch}},error:null});
      await expect(readFamilyAccess(saved.client)).rejects.toThrow('family access');expect(saved.from).not.toHaveBeenCalled();
    }
    const saved=mockClient();saved.patch('user_roles',{data:[],error:null});await expect(readFamilyAccess(saved.client)).rejects.toThrow('family access');
  });
  it.each([
    ['profiles',{id:id(1),school_id:id(2),full_name:'QA',is_active:false}],
    ['profiles',{id:id(1),school_id:'bad',full_name:'QA',is_active:true}],
    ['user_roles',[{user_id:id(1),school_id:id(9),role:'parent'}]],
    ['user_roles',[{user_id:id(9),school_id:id(2),role:'parent'}]],
    ['user_roles',[{user_id:id(1),school_id:id(2),role:'school_admin'}]],
  ])('fails closed for mismapped %s metadata',async(table: unknown,data: unknown)=>{
    const saved=mockClient();saved.patch(table as string,{data,error:null});await expect(readFamilyAccess(saved.client)).rejects.toThrow('family access');
  });
  it('rejects a revoked native session even when Auth user and role rows appear valid',async()=>{
    const saved=mockClient();saved.rpc.mockImplementation(()=>Object.assign(Promise.resolve({data:null,error:{code:'42501'}}),{abortSignal:vi.fn()}));
    await expect(readFamilyAccess(saved.client)).rejects.toThrow('family access');
  });
  it('lists only complete current linked children from the exact school and whitelists fields',async()=>{
    const saved=mockClient();saved.patch('students',{data:[{...child,dob:'2014-01-01',registered_mobile:'private'}],error:null});
    expect(await listChildren(saved.client,access,'parent')).toEqual([child]);
    expect(saved.queries.find(q=>q.table==='students')?.filters).toEqual([['school_id',id(2)],['id',[id(3)]]]);
    expect(saved.queries.find(q=>q.table==='parents')?.filters).toContainEqual(['profile_id',id(1)]);
  });
  it('preserves retained inactive children while denying unlinked/foreign/truncated or duplicate mappings',async()=>{
    const saved=mockClient();saved.patch('students',{data:[{...child,status:'withdrawn'}],error:null});expect((await listChildren(saved.client,access,'parent'))[0].status).toBe('withdrawn');
    for(const data of [[{...child,school_id:id(9)}],[{...child,id:id(9)}],[]]){
      saved.patch('students',{data,error:null});await expect(listChildren(saved.client,access,'parent')).rejects.toThrow('could not be verified');
    }
    saved.patch('student_parents',{data:[{student_id:id(3)},{student_id:id(3)}],count:2,error:null});await expect(listChildren(saved.client,access,'parent')).rejects.toThrow('could not be verified');
    saved.patch('student_parents',{data:[{student_id:id(3)}],count:2,error:null});await expect(listChildren(saved.client,access,'parent')).rejects.toThrow('could not be verified');
  });
  it('reads Student profile by both actual uid and school, with no sibling fallback',async()=>{
    const saved=mockClient();const student={...access,roles:['student'] as const};
    expect(await listChildren(saved.client,{...student,roles:['student']},'student')).toEqual([child]);
    expect(saved.queries.find(q=>q.table==='students')?.filters).toEqual([['profile_id',id(1)],['school_id',id(2)]]);
    saved.patch('students',{data:null,error:null});expect(await listChildren(saved.client,{...student,roles:['student']},'student')).toEqual([]);
  });
  it('refuses account/school mismatch before child data queries and supports cancellation',async()=>{
    const saved=mockClient();saved.auth.mockResolvedValue({data:{user:{id:id(9),email_confirmed_at:stamp}},error:null});
    await expect(listChildren(saved.client,access,'parent')).rejects.toThrow('family access');expect(saved.queries.some(q=>q.table==='parents')).toBe(false);
    const controller=new AbortController();controller.abort();await expect(readFamilyAccess(saved.client,controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('loads exact selected-child attendance with safe read-only pagination and complete count',async()=>{
    const saved=mockClient();saved.patch('attendance',{data:[{attendance_date:'2026-11-05',academic_year_id:id(5),status:'absent',student_id:id(3),school_id:id(2),private_note:'omitted'}],count:31,error:null});
    const signal=new AbortController().signal;
    expect(await loadAttendance(saved.client,access,'parent',child,{offset:30,limit:30},signal)).toEqual({rows:[{attendance_date:'2026-11-05',academic_year_id:id(5),status:'absent'}],count:31});
    const query=saved.queries.find(q=>q.table==='attendance')!;expect(query.filters).toEqual([['school_id',id(2)],['student_id',id(3)]]);expect(query.range).toEqual([30,59]);expect(query.abort).toBe(signal);
  });
  it('denies a no-longer-linked selected child and never queries its history',async()=>{
    const saved=mockClient();saved.patch('student_parents',{data:[],count:0,error:null});await expect(loadAttendance(saved.client,access,'parent',child)).rejects.toThrow('family access');
    expect(saved.queries.some(q=>q.table==='attendance')).toBe(false);
  });
  it('filters the full scoped dataset by year, month and status before pagination, including leap day',async()=>{
    const saved=mockClient(), row={attendance_date:'2028-02-29',academic_year_id:id(5),status:'absent',student_id:id(3),school_id:id(2)};
    const filters={yearId:id(5),month:'2028-02-01',status:'absent' as const};
    saved.patch('attendance',{data:[row],count:1,error:null});
    expect((await loadAttendance(saved.client,access,'parent',child,filters)).count).toBe(1);
    expect(saved.queries.find(q=>q.table==='attendance')?.filters).toEqual([
      ['school_id',id(2)],['student_id',id(3)],['academic_year_id',id(5)],['gte:attendance_date','2028-02-01'],['lte:attendance_date','2028-02-29'],['status','absent'],
    ]);
    await expect(loadAttendance(saved.client,access,'parent',child,{...filters,month:'2028-02-29'})).rejects.toThrow('valid attendance filter');
    await expect(loadAttendance(saved.client,access,'parent',child,{...filters,month:'2028-01-01'})).rejects.toThrow('could not be verified');
    saved.patch('attendance',{data:[row],count:2,error:null});
    await expect(loadAttendance(saved.client,access,'parent',child,filters)).rejects.toThrow('could not be verified');
  });
  it.each([
    {attendance_date:'2026-02-30',academic_year_id:id(5),status:'absent'},
    {attendance_date:'2026-11-05',academic_year_id:'bad',status:'absent'},
    {attendance_date:'2026-11-05',academic_year_id:id(5),status:'unmarked'},
  ])('rejects incoherent attendance rows %j',async(row: unknown)=>{
    const saved=mockClient();saved.patch('attendance',{data:[row],count:1,error:null});await expect(loadAttendance(saved.client,access,'parent',child)).rejects.toThrow('could not be verified');
  });
  it('rejects mismapped Student ownership and attendance scope despite a successful query',async()=>{
    const saved=mockClient();saved.patch('students',{data:{...child,profile_id:id(99)},error:null});
    await expect(listChildren(saved.client,{...access,roles:['student']},'student')).rejects.toThrow('could not be verified');
    for(const patch of [{student_id:id(99)},{school_id:id(99)}]){
      const state=mockClient();state.patch('attendance',{data:[{attendance_date:'2026-11-05',academic_year_id:id(5),status:'absent',student_id:id(3),school_id:id(2),...patch}],count:1,error:null});
      await expect(loadAttendance(state.client,access,'parent',child)).rejects.toThrow('could not be verified');
    }
  });
  it('rejects duplicate or uncounted attendance pages instead of fabricating totals',async()=>{
    const row={attendance_date:'2026-11-05',academic_year_id:id(5),status:'absent',student_id:id(3),school_id:id(2)},saved=mockClient();
    saved.patch('attendance',{data:[row,row],count:2,error:null});await expect(loadAttendance(saved.client,access,'parent',child)).rejects.toThrow();
    saved.patch('attendance',{data:[row],count:null,error:null});await expect(loadAttendance(saved.client,access,'parent',child)).rejects.toThrow();
    await expect(loadAttendance(saved.client,access,'parent',child,{limit:61})).rejects.toThrow('valid attendance page');
  });
});

const alert = (patch:Partial<FamilyNotification>={}):FamilyNotification=>({id:id(10),kind:'absence',student_id:id(3),student_name:'QA child',created_at:stamp,read_at:null,event_date:'2026-11-06',source_id:id(11),status:'absent',title:'Attendance marked absent',assessment_id:null,occurred_at:null,delayed:false,...patch});
function rpcClient(data:unknown,error:{code:string}|null=null){const abortSignal=vi.fn().mockResolvedValue({data,error});const rpc=vi.fn().mockReturnValue(Object.assign(Promise.resolve({data,error}),{abortSignal}));return {client:{rpc} as unknown as SupabaseClient,rpc,abortSignal};}
describe('family attendance years and assigned teachers', () => {
  const scope={user_id:id(1),school_id:id(2),student_id:id(3),role:'parent'};
  const year={id:id(5),name:'2026–27',start_date:'2026-09-10',end_date:'2027-03-10'};
  it('uses the verified school year context to offer past months and excludes future months',async()=>{
    const remote=rpcClient({...scope,timezone:'Asia/Kolkata',server_today:'2026-11-10',years:[year]});
    const signal=new AbortController().signal;
    const result=await loadAttendanceYears(remote.client,access,'parent',child,signal);
    expect(result.years).toEqual([year]);
    expect(attendanceMonths(result.years[0],result.today)).toEqual(['2026-11-01','2026-10-01','2026-09-01']);
    expect(remote.rpc).toHaveBeenCalledWith('get_family_attendance_report_context',{p_role:'parent',p_student_id:id(3)});
    expect(remote.abortSignal).toHaveBeenCalledWith(signal);
    const mismatched=rpcClient({...scope,student_id:id(8),timezone:'Asia/Kolkata',server_today:'2026-11-10',years:[year]});
    await expect(loadAttendanceYears(mismatched.client,access,'parent',child)).rejects.toThrow('could not be verified');
  });
  it('shows scoped teacher labels only and distinguishes unavailable service from unassigned classes',async()=>{
    const item={id:id(10),name:'Teacher A',is_class_teacher:true,subjects:['Mathematics'],registered_mobile:'private'};
    const data={...scope,academic_year_name:'2026–27',class_name:'Grade 6',section_name:'A',teachers:[item]};
    const remote=rpcClient(data);
    expect(await loadClassTeachers(remote.client,access,'parent',child)).toEqual({year:'2026–27',className:'Grade 6',section:'A',teachers:[
      {id:id(10),name:'Teacher A',isClassTeacher:true,subjects:['Mathematics']},
    ]});
    expect(remote.rpc).toHaveBeenCalledWith('get_family_class_teachers',{p_role:'parent',p_student_id:id(3)});
    await expect(loadClassTeachers(rpcClient(null,{code:'PGRST202'}).client,access,'parent',child)).rejects.toThrow('not available');
    await expect(loadClassTeachers(rpcClient(null,{code:'42501'}).client,access,'parent',child)).rejects.toThrow('family access');
    for(const patch of [{school_id:id(9)},{role:'student'},{section_name:null},{teachers:[item,{...item,id:id(11)}]}]){
      await expect(loadClassTeachers(rpcClient({...data,...patch}).client,access,'parent',child)).rejects.toThrow('could not be verified');
    }
    expect(await loadClassTeachers(rpcClient({...data,teachers:[]}).client,access,'parent',child)).toMatchObject({className:'Grade 6',teachers:[]});
  });
});
const inbox=(notifications=[alert()], role: 'parent' | 'student' = 'parent')=>({user_id:id(1),role,notifications,unread_count:'3',next_cursor:null});
describe('native shared notification contract',()=>{
  it('keeps server unread filtering, cursor precision, exact limits and AbortSignal',async()=>{
    const next={created_at:stamp,kind:'absence' as const,id:id(10)},saved=rpcClient({...inbox(),next_cursor:next});const signal=new AbortController().signal;
    const result=await loadFamilyNotificationInbox(saved.client,{userId:id(1),role:'parent',unreadOnly:true,limit:1},signal);expect(result.next_cursor).toEqual(next);expect(result.unread_count).toBe(3);expect(saved.abortSignal).toHaveBeenCalledWith(signal);
    expect(saved.rpc).toHaveBeenCalledWith('get_family_notification_inbox_v8',{p_role:'parent',p_unread_only:true,p_limit:1,p_before_created_at:null,p_before_kind:null,p_before_id:null});
  });
  it.each([
    {notifications:[alert(),alert()]}, {notifications:[alert({event_date:'2026-02-30'})]}, {notifications:[alert({kind:'result_published',status:'published'})]},
    {unread_count:'9007199254740992'}, {user_id:id(99)}, {role:'student'}, {next_cursor:{created_at:stamp,kind:'absence',id:id(99)}},
  ])('rejects malformed native inbox responses %j',async(patch: Record<string, unknown>)=>{
    await expect(loadFamilyNotificationInbox(rpcClient({...inbox(),...patch}).client,{userId:id(1),role:'parent'})).rejects.toThrow('could not be verified');
  });
  it('whitelists fields, distinguishes unavailable marks and validates mutation acknowledgements',async()=>{
    const saved=rpcClient(inbox([{...alert(),review_note:'private'} as FamilyNotification], 'student'));expect((await loadFamilyNotificationInbox(saved.client,{userId:id(1),role:'student'})).notifications[0]).not.toHaveProperty('review_note');
    expect(await markFamilyNotificationRead(rpcClient(null).client,'parent','absence',id(10))).toBeNull();
    expect(await markFamilyNotificationRead(rpcClient(stamp).client,'student','result_published',id(10))).toBe(stamp);
    expect(await markAllFamilyNotificationsRead(rpcClient('3').client,'parent')).toBe(3);expect(await loadFamilyNotificationUnreadCount(rpcClient('3').client,'student')).toBe(3);
    await expect(markAllFamilyNotificationsRead(rpcClient(-1).client,'parent')).rejects.toThrow();await expect(markFamilyNotificationRead(rpcClient('ok').client,'parent','absence',id(10))).rejects.toThrow();
  });
  it('rejects high-role contexts, invalid references and unread pages containing read records',async()=>{
    const saved=rpcClient(inbox());await expect(loadFamilyNotificationInbox(saved.client,{userId:id(1),role:'admin' as 'parent'})).rejects.toThrow('valid family');expect(saved.rpc).not.toHaveBeenCalled();
    await expect(markFamilyNotificationRead(saved.client,'parent','absence','bad')).rejects.toThrow();
    await expect(loadFamilyNotificationInbox(rpcClient(inbox([alert({read_at:stamp})])).client,{userId:id(1),role:'parent',unreadOnly:true})).rejects.toThrow();
  });
});

describe('native exam schedule alerts', () => {
  const exam = alert({ kind: 'exam_schedule', status: 'rescheduled', student_id: null, student_name: null, title: 'Math test' });
  it('reads the shared exam event, then marks its revision rather than its assessment', async () => {
    const saved = rpcClient(inbox([exam]));
    expect((await loadFamilyNotificationInbox(saved.client, { userId: id(1), role: 'parent' })).notifications).toEqual([exam]);
    const mark = rpcClient(stamp);
    await expect(markFamilyNotificationRead(mark.client, 'parent', exam.kind, exam.id)).resolves.toBe(stamp);
    expect(mark.rpc).toHaveBeenCalledWith('mark_family_notification_read_v8', { p_role: 'parent', p_kind: 'exam_schedule', p_id: exam.id });
    const invalid = rpcClient(inbox([{ ...exam, student_id: id(3) }]));
    await expect(loadFamilyNotificationInbox(invalid.client, { userId: id(1), role: 'parent' })).rejects.toThrow('could not be verified');
  });

  it('opens only the exact assessment and whitelists its schedule fields', async () => {
    const detail = { id: exam.source_id, name: exam.title, assessment_date: exam.event_date, subject_name: 'Math',
      class_name: 'Class 7', section_name: null, description: 'Bring a pencil.' };
    const signal = new AbortController().signal;
    const saved = rpcClient({ ...detail, marks: 98, student_id: id(3) });
    await expect(getFamilyExamSchedule(saved.client, 'parent', exam.source_id, signal)).resolves.toEqual(detail);
    expect(saved.rpc).toHaveBeenCalledWith('get_family_exam_schedule', { p_role: 'parent', p_assessment_id: exam.source_id });
    expect(saved.abortSignal).toHaveBeenCalledWith(signal);
    await expect(getFamilyExamSchedule(rpcClient(null).client, 'student', exam.source_id, signal)).resolves.toBeNull();
    await expect(getFamilyExamSchedule(rpcClient({ ...detail, id: exam.id }).client, 'student', exam.source_id, signal)).rejects.toThrow('could not be verified');
    const invalid = rpcClient(detail);
    await expect(getFamilyExamSchedule(invalid.client, 'student', [exam.source_id, exam.id], signal)).rejects.toThrow('exam link is invalid');
    expect(invalid.rpc).not.toHaveBeenCalled();
  });
});

describe('definitive family access denial',()=>{
  it('marks a teacher-only/revoked account and an inactive profile as denied, but not a transport failure',async()=>{
    const noRoles=mockClient();noRoles.patch('user_roles',{data:[],error:null});
    await expect(readFamilyAccess(noRoles.client)).rejects.toMatchObject({name:'FamilyAccessDenied',message:expect.stringContaining('family access')});
    const inactive=mockClient();inactive.patch('profiles',{data:{id:id(1),school_id:id(2),full_name:'QA',is_active:false},error:null});
    await expect(readFamilyAccess(inactive.client)).rejects.toMatchObject({name:'FamilyAccessDenied'});
    const network=mockClient();network.patch('user_roles',{data:null,error:{message:'network'}});
    const failure=await readFamilyAccess(network.client).catch((error:Error)=>error);
    expect(failure).toBeInstanceOf(Error);expect((failure as Error).name).not.toBe('FamilyAccessDenied');
  });
});
