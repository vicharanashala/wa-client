export abstract class UserDetailsRepository {
  abstract getLastRephrasedQuery(userId: string): Promise<string | null>;
}
