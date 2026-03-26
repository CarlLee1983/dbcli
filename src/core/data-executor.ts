/**
 * 資料執行器 — 處理 INSERT、UPDATE、DELETE 操作的執行
 *
 * 責任：執行資料修改操作，強制權限檢查，驗證資料欄位，
 * 處理參數化查詢防止 SQL 注入。
 */

import type { DatabaseAdapter, TableSchema, ColumnSchema } from '@/adapters/types'
import type { Permission } from '@/types'
import type { DataExecutionResult, DataExecutionOptions } from '@/types/data'
import { enforcePermission, PermissionError } from '@/core/permission-guard'
import { promptUser } from '@/utils/prompts'
import type { BlacklistValidator } from '@/core/blacklist-validator'
import { BlacklistError } from '@/types/blacklist'

/**
 * 資料執行器類，用於執行 INSERT、UPDATE、DELETE 操作
 */
export class DataExecutor {
  constructor(
    private adapter: DatabaseAdapter,
    private permission: Permission,
    private dbSystem: 'postgresql' | 'mysql' = 'postgresql',
    private blacklistValidator?: BlacklistValidator
  ) {}

  /**
   * 構建參數化的 INSERT SQL 語句
   * 返回 {sql, params} 形式以防止 SQL 注入
   *
   * @param tableName 資料表名稱
   * @param data 要插入的資料物件 {column: value, ...}
   * @param schema 資料表結構
   * @returns 參數化 SQL 和參數陣列
   * @throws Error 如果資料欄位不在表結構中
   */
  buildInsertSql(
    tableName: string,
    data: Record<string, any>,
    schema: TableSchema
  ): { sql: string; params: any[] } {
    // 驗證所有資料欄位都存在於表結構中
    const columnNames = schema.columns.map((col) => col.name)
    const dataKeys = Object.keys(data)

    for (const key of dataKeys) {
      if (!columnNames.includes(key)) {
        throw new Error(
          `資料表 "${tableName}" 中找不到欄位 "${key}"。有效的欄位: ${columnNames.join(', ')}`
        )
      }
    }

    // 建立參數化查詢
    const columns = dataKeys
    const values = dataKeys.map((key) => data[key])

    // 根據資料庫系統類型決定參數標記
    // PostgreSQL 使用 $1, $2, ...
    // MySQL 使用 ?
    const systemType = this.getSystemType()
    const placeholders =
      systemType === 'postgresql'
        ? dataKeys.map((_, index) => `$${index + 1}`).join(', ')
        : dataKeys.map(() => '?').join(', ')

    const quote = this.getQuoteChar()
    const sql = `INSERT INTO ${quote}${tableName}${quote} (${columns.map((col) => `${quote}${col}${quote}`).join(', ')}) VALUES (${placeholders})`

    return {
      sql,
      params: values,
    }
  }

  /**
   * 執行 INSERT 操作
   * 強制權限檢查，建立 SQL，顯示確認提示，執行
   *
   * @param tableName 資料表名稱
   * @param data 要插入的資料物件
   * @param schema 資料表結構
   * @param options 執行選項 (dryRun, force, verbose)
   * @returns DataExecutionResult
   * @throws PermissionError 如果權限不足
   * @throws Error 如果執行失敗
   */
  async executeInsert(
    tableName: string,
    data: Record<string, any>,
    schema: TableSchema,
    options?: DataExecutionOptions
  ): Promise<DataExecutionResult> {
    const timestamp = new Date().toISOString()

    try {
      // 0. Check table blacklist before doing anything else
      if (this.blacklistValidator) {
        this.blacklistValidator.checkTableBlacklist('INSERT', tableName, [])
      }

      // 1. 強制權限檢查 - INSERT 需要 read-write 或 admin
      enforcePermission('INSERT INTO dummy', this.permission)

      // 2. 建立參數化 SQL
      const { sql, params } = this.buildInsertSql(tableName, data, schema)

      // 3. 乾執行模式：顯示 SQL 但不執行
      if (options?.dryRun) {
        return {
          status: 'success',
          operation: 'insert',
          rows_affected: 0,
          timestamp,
          sql,
        }
      }

      // 4. 非強制模式：顯示 SQL 並要求確認
      if (!options?.force) {
        console.log('\n生成的 SQL:')
        console.log(`  ${sql}`)
        console.log('\n參數:')
        console.log(`  ${JSON.stringify(params, null, 2)}`)

        const confirmed = await promptUser.confirm('是否執行此操作?')
        if (!confirmed) {
          return {
            status: 'success',
            operation: 'insert',
            rows_affected: 0,
            timestamp,
            sql,
          }
        }
      }

      // 5. 執行 INSERT
      const result = await this.adapter.execute(sql, params)

      // 返回結果
      const affectedRows = Array.isArray(result) ? result.length : 0
      return {
        status: 'success',
        operation: 'insert',
        rows_affected: affectedRows,
        timestamp,
        sql,
      }
    } catch (error) {
      // BlacklistError passes through to caller
      if (error instanceof BlacklistError) {
        throw error
      }

      const errorMessage = error instanceof Error ? error.message : String(error)

      // 權限錯誤特殊處理
      if (error instanceof PermissionError) {
        return {
          status: 'error',
          operation: 'insert',
          rows_affected: 0,
          timestamp,
          error: '權限被拒: Query-only 模式僅允許 SELECT。使用 Read-Write 或 Admin 模式執行 INSERT。',
        }
      }

      return {
        status: 'error',
        operation: 'insert',
        rows_affected: 0,
        timestamp,
        error: `INSERT 失敗: ${errorMessage}`,
      }
    }
  }

  /**
   * 執行 UPDATE 操作
   * 強制權限檢查，建立 SQL，顯示確認提示，執行
   *
   * @param tableName 資料表名稱
   * @param data 更新的資料物件
   * @param where WHERE 子句條件物件
   * @param schema 資料表結構
   * @param options 執行選項
   * @returns DataExecutionResult
   */
  async executeUpdate(
    tableName: string,
    data: Record<string, any>,
    where: Record<string, any>,
    schema: TableSchema,
    options?: DataExecutionOptions
  ): Promise<DataExecutionResult> {
    const timestamp = new Date().toISOString()

    try {
      // 0. Check table blacklist before doing anything else
      if (this.blacklistValidator) {
        this.blacklistValidator.checkTableBlacklist('UPDATE', tableName, [])
      }

      // 1. 強制權限檢查
      enforcePermission('UPDATE dummy', this.permission)

      // 2. 建立參數化 UPDATE SQL
      const { sql, params } = this.buildUpdateSql(
        tableName,
        data,
        where,
        schema
      )

      // 3. 乾執行模式
      if (options?.dryRun) {
        return {
          status: 'success',
          operation: 'update',
          rows_affected: 0,
          timestamp,
          sql,
        }
      }

      // 4. 非強制模式：顯示 SQL 並要求確認
      if (!options?.force) {
        console.log('\n生成的 SQL:')
        console.log(`  ${sql}`)
        console.log('\n參數:')
        console.log(`  ${JSON.stringify(params, null, 2)}`)

        const confirmed = await promptUser.confirm('是否執行此操作?')
        if (!confirmed) {
          return {
            status: 'success',
            operation: 'update',
            rows_affected: 0,
            timestamp,
            sql,
          }
        }
      }

      // 5. 執行 UPDATE
      const result = await this.adapter.execute(sql, params)
      const affectedRows = Array.isArray(result) ? result.length : 0

      return {
        status: 'success',
        operation: 'update',
        rows_affected: affectedRows,
        timestamp,
        sql,
      }
    } catch (error) {
      // BlacklistError passes through to caller
      if (error instanceof BlacklistError) {
        throw error
      }

      const errorMessage = error instanceof Error ? error.message : String(error)

      if (error instanceof PermissionError) {
        return {
          status: 'error',
          operation: 'update',
          rows_affected: 0,
          timestamp,
          error: '權限被拒: Query-only 模式僅允許 SELECT。使用 Read-Write 或 Admin 模式執行 UPDATE。',
        }
      }

      return {
        status: 'error',
        operation: 'update',
        rows_affected: 0,
        timestamp,
        error: `UPDATE 失敗: ${errorMessage}`,
      }
    }
  }

  /**
   * 執行 DELETE 操作
   * Admin-only 操作，需要強制權限檢查
   *
   * @param tableName 資料表名稱
   * @param where WHERE 子句條件物件
   * @param schema 資料表結構
   * @param options 執行選項
   * @returns DataExecutionResult
   */
  async executeDelete(
    tableName: string,
    where: Record<string, any>,
    schema: TableSchema,
    options?: DataExecutionOptions
  ): Promise<DataExecutionResult> {
    const timestamp = new Date().toISOString()

    try {
      // 0. Check table blacklist before doing anything else
      if (this.blacklistValidator) {
        this.blacklistValidator.checkTableBlacklist('DELETE', tableName, [])
      }

      // 1. DELETE 需要 admin 權限（更嚴格的限制）
      if (this.permission !== 'admin') {
        return {
          status: 'error',
          operation: 'delete',
          rows_affected: 0,
          timestamp,
          error: '權限被拒: DELETE 操作需要 Admin 權限。',
        }
      }

      // 2. 建立參數化 DELETE SQL
      const { sql, params } = this.buildDeleteSql(
        tableName,
        where,
        schema
      )

      // 3. 乾執行模式
      if (options?.dryRun) {
        return {
          status: 'success',
          operation: 'delete',
          rows_affected: 0,
          timestamp,
          sql,
        }
      }

      // 4. DELETE 通常要求確認（除非 --force 標記）
      if (!options?.force) {
        console.log('\n⚠️  警告: DELETE 操作是破壞性的，無法撤銷！')
        console.log('\n生成的 SQL:')
        console.log(`  ${sql}`)
        console.log('\n參數:')
        console.log(`  ${JSON.stringify(params, null, 2)}`)

        const confirmed = await promptUser.confirm(
          '是否真的要執行此 DELETE 操作? 此操作無法撤銷。'
        )
        if (!confirmed) {
          return {
            status: 'success',
            operation: 'delete',
            rows_affected: 0,
            timestamp,
            sql,
          }
        }
      }

      // 5. 執行 DELETE
      const result = await this.adapter.execute(sql, params)
      const affectedRows = Array.isArray(result) ? result.length : 0

      return {
        status: 'success',
        operation: 'delete',
        rows_affected: affectedRows,
        timestamp,
        sql,
      }
    } catch (error) {
      // BlacklistError passes through to caller
      if (error instanceof BlacklistError) {
        throw error
      }

      const errorMessage = error instanceof Error ? error.message : String(error)

      return {
        status: 'error',
        operation: 'delete',
        rows_affected: 0,
        timestamp,
        error: `DELETE 失敗: ${errorMessage}`,
      }
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * 取得資料庫系統類型（用於決定參數標記和識別符引號）
   */
  private getSystemType(): 'postgresql' | 'mysql' {
    return this.dbSystem
  }

  /**
   * 獲取識別符引號符號（表名、欄位名）
   */
  private getQuoteChar(): string {
    return this.dbSystem === 'mysql' ? '`' : '"'
  }

  /**
   * 建立參數化的 UPDATE SQL 語句
   */
  private buildUpdateSql(
    tableName: string,
    data: Record<string, any>,
    where: Record<string, any>,
    schema: TableSchema
  ): { sql: string; params: any[] } {
    const dataKeys = Object.keys(data)
    const whereKeys = Object.keys(where)
    const columnNames = schema.columns.map((col) => col.name)

    // 驗證欄位
    for (const key of [...dataKeys, ...whereKeys]) {
      if (!columnNames.includes(key)) {
        throw new Error(
          `資料表 "${tableName}" 中找不到欄位 "${key}"`
        )
      }
    }

    // 建立 UPDATE SET 子句
    const systemType = this.getSystemType()
    const quote = this.getQuoteChar()
    let paramIndex = 1

    const setClause = dataKeys
      .map((key) => {
        const placeholder =
          systemType === 'postgresql' ? `$${paramIndex++}` : '?'
        return `${quote}${key}${quote} = ${placeholder}`
      })
      .join(', ')

    // 建立 WHERE 子句
    const whereClause = whereKeys
      .map((key) => {
        const placeholder =
          systemType === 'postgresql' ? `$${paramIndex++}` : '?'
        return `${quote}${key}${quote} = ${placeholder}`
      })
      .join(' AND ')

    const sql = `UPDATE ${quote}${tableName}${quote} SET ${setClause} WHERE ${whereClause}`
    const params = [...dataKeys.map((key) => data[key]), ...whereKeys.map((key) => where[key])]

    return { sql, params }
  }

  /**
   * 建立參數化的 DELETE SQL 語句
   */
  private buildDeleteSql(
    tableName: string,
    where: Record<string, any>,
    schema: TableSchema
  ): { sql: string; params: any[] } {
    const whereKeys = Object.keys(where)
    const columnNames = schema.columns.map((col) => col.name)

    // 驗證欄位
    for (const key of whereKeys) {
      if (!columnNames.includes(key)) {
        throw new Error(
          `資料表 "${tableName}" 中找不到欄位 "${key}"`
        )
      }
    }

    // 建立 WHERE 子句
    const systemType = this.getSystemType()
    const quote = this.getQuoteChar()
    let paramIndex = 1

    const whereClause = whereKeys
      .map((key) => {
        const placeholder =
          systemType === 'postgresql' ? `$${paramIndex++}` : '?'
        return `${quote}${key}${quote} = ${placeholder}`
      })
      .join(' AND ')

    const sql = `DELETE FROM ${quote}${tableName}${quote} WHERE ${whereClause}`
    const params = whereKeys.map((key) => where[key])

    return { sql, params }
  }
}
