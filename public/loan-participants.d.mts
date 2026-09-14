export const participantRoles: string[];
export type Participant={name:string;role:string};
export function parseParticipants(value:string):{choice:string;people:Participant[];valid:boolean;legacy:string};
export function formatParticipants(choice:string,people:Participant[]):string;
