# Security Specification - Achour Player

## Data Invariants
1.  **User Isolation**: Users can only read and write their own `user_preferences` and `playlists`.
2.  **Identity Integrity**: The `userId` field in any document must match the authenticated user's ID (`request.auth.uid`).
3.  **Schema Validation**: All writes must conform to the types, sizes, and enums defined in the blueprint.
4.  **Temporal Integrity**: `updatedAt` and `createdAt` must be set to the server time during writes.
5.  **Immutability**: `userId` and `createdAt` fields cannot be changed after creation.

## The "Dirty Dozen" Payloads

### 1. Identity Spoofing (Create)
Attempt to create a playlist for another user.
```json
{
  "name": "Hacker Playlist",
  "type": "xtream",
  "userId": "victim_user_id"
}
```
**Expected**: PERMISSION_DENIED (userId must match request.auth.uid)

### 2. Identity Spoofing (Update)
Attempt to take over someone else's playlist.
```json
{
  "userId": "attacker_user_id"
}
```
**Expected**: PERMISSION_DENIED (userId is immutable)

### 3. State Shortcutting / Ghost Fields
Injecting unauthorized fields into user preferences.
```json
{
  "userId": "my_id",
  "isAdmin": true,
  "isPremium": true
}
```
**Expected**: PERMISSION_DENIED (hasOnly validation)

### 4. Resource Poisoning (ID)
Injecting a massive string as a document ID.
Path: `/playlists/a-very-long-id-that-exceeds-128-characters-...`
**Expected**: PERMISSION_DENIED (isValidId check)

### 5. Value Poisoning (Enum)
Using an invalid playlist type.
```json
{
  "name": "Bad Type",
  "type": "illegal_type",
  "userId": "my_id"
}
```
**Expected**: PERMISSION_DENIED (enum validation)

### 6. Value Poisoning (Size)
Injecting a massive string into the name field.
```json
{
  "name": "A".repeat(200),
  "type": "xtream",
  "userId": "my_id"
}
```
**Expected**: PERMISSION_DENIED (maxLength validation)

### 7. Denial of Wallet (Array Size)
Injecting 10,000 favorites.
```json
{
  "userId": "my_id",
  "favorites": ["id"].repeat(10000)
}
```
**Expected**: PERMISSION_DENIED (maxItems validation)

### 8. PII Leakage
Attempting to read another user's preferences.
Path: `/user_preferences/victim_id`
**Expected**: PERMISSION_DENIED (isOwner check)

### 9. Temporal Spoofing
Attempting to set a manual past date for `updatedAt`.
```json
{
  "userId": "my_id",
  "updatedAt": "2000-01-01T00:00:00Z"
}
```
**Expected**: PERMISSION_DENIED (server timestamp check)

### 10. Orphaned Record (Playlist)
Creating a playlist without a name.
```json
{
  "type": "xtream",
  "userId": "my_id"
}
```
**Expected**: PERMISSION_DENIED (required field check)

### 11. Type Poisoning
Setting `isProtected` to a string instead of a boolean.
```json
{
  "name": "Test",
  "type": "xtream",
  "userId": "my_id",
  "isProtected": "yes"
}
```
**Expected**: PERMISSION_DENIED (type check)

### 12. Unverified User Write
Attempting to write while email is not verified (if mandated).
**Expected**: PERMISSION_DENIED (email_verified check)
