export interface Principal {
  userId: string;
  username: string;
  fullName: string;
  tenantId: string;
  tenantName: string;
  roles: string[];
}

export type Capability = 'directory.read' | 'salary.read' | 'leave.approve' | 'stats.read';

export interface Employee {
  id: number;
  code: string;
  name: string;
  dept: string;
  title: string;
  level: number;
  email: string;
  phone: string;
  branch: string;
  hired: string;
  status: 'active' | 'leave' | 'probation';
  avatar: number;
  age: number;
  skills: string[];
  salary: number;
}

export type LeaveType = 'Phép năm' | 'Nghỉ ốm' | 'Việc riêng' | 'Thai sản';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface Leave {
  id: string;
  employeeId: number;
  type: LeaveType;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  createdBy: string;
  createdAt: string;
  decidedBy?: string;
  requestId?: string;
}
