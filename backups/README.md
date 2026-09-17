# Encrypted database backup

`production-2026-09-16.sql.enc` is a full production MySQL dump encrypted with
AES-256-CBC, PBKDF2, and 600,000 iterations. The recovery password is not stored
in this repository.

To restore it on a new computer:

1. Install and start MySQL.
2. Copy `.env` and `private.key` through a secure channel.
3. Configure the MySQL administrative connection in `.env`. For a protected
  TCP account, set the administrative user and password:

  ```dotenv
  MYSQL_ADMIN_USER=root
  MYSQL_ADMIN_PASSWORD=your-root-password
  MYSQL_ADMIN_HOST=127.0.0.1
  MYSQL_ADMIN_PORT=3306
  ```

  For Unix-socket authentication, set the socket instead. The socket setting
  takes precedence over `MYSQL_ADMIN_HOST` and `MYSQL_ADMIN_PORT`:

  ```dotenv
  MYSQL_ADMIN_USER=root
  MYSQL_ADMIN_SOCKET=/var/run/mysqld/mysqld.sock
  ```

  `MYSQL_ROOT_USER`, `MYSQL_ROOT_PASSWORD`, and `MYSQL_ROOT_SOCKET` are also
  accepted as aliases. Do not commit these settings or their values.
4. Put the recovery password in a temporary file with mode `600`.
5. Run:

   ```sh
   node scripts/restore-local-backup.js \
     backups/production-2026-09-16.sql.enc \
     /path/to/password-file
   ```

Delete the temporary password file after the restore succeeds.
