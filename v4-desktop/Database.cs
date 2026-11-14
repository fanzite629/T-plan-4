using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Drawing;
using System.Reflection;
using System.Security.Cryptography;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
[ComVisible(true), ClassInterface(ClassInterfaceType.AutoDual)]
public class Database : IDisposable {
 IntPtr db;
 [DllImport("winsqlite3.dll", CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_open16([MarshalAs(UnmanagedType.LPWStr)] string path,out IntPtr db);
 [DllImport("winsqlite3.dll", CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_exec(IntPtr db,byte[] sql,Callback cb,IntPtr arg,out IntPtr error);
 [DllImport("winsqlite3.dll", CallingConvention=CallingConvention.Cdecl)] static extern void sqlite3_free(IntPtr ptr);
 [DllImport("winsqlite3.dll", CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_close(IntPtr db);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Callback(IntPtr a,int n,IntPtr values,IntPtr names);
 static string Utf8(IntPtr p){if(p==IntPtr.Zero)return "";int n=0;while(Marshal.ReadByte(p,n)!=0)n++;byte[] b=new byte[n];Marshal.Copy(p,b,0,n);return Encoding.UTF8.GetString(b);}
 static string Hex(string s){return BitConverter.ToString(Encoding.UTF8.GetBytes(s)).Replace("-","");}
 string Run(string sql){string result="";Callback cb=delegate(IntPtr a,int n,IntPtr v,IntPtr names){result=Utf8(Marshal.ReadIntPtr(v));return 0;};IntPtr error;int rc=sqlite3_exec(db,Encoding.UTF8.GetBytes(sql+"\0"),cb,IntPtr.Zero,out error);if(error!=IntPtr.Zero)sqlite3_free(error);if(rc!=0)throw new IOException("SQLite error "+rc);return result;}
 public Database(string path){if(sqlite3_open16(path,out db)!=0)throw new IOException("无法打开数据库");Run("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS storage(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL); PRAGMA user_version=1;");if(Run("PRAGMA quick_check;")!="ok")throw new IOException("数据库完整性检查失败");}
 public string Read(string key){Check(key);return Run("SELECT value FROM storage WHERE key='"+key.Replace("'","''")+"';");}
 public void Write(string key,string value){Check(key);if(value==null||value.Length>32000000)throw new ArgumentException("数据过大");Run("INSERT OR REPLACE INTO storage VALUES('"+key.Replace("'","''")+"','"+value.Replace("'","''")+"',datetime('now'));");}
 public string ReadSecret(){string s=Read("secret");return s==""?"":Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s),null,DataProtectionScope.CurrentUser));}
 public void WriteSecret(string value){Write("secret",value==""?"":Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(value),null,DataProtectionScope.CurrentUser)));}
 static void Check(string key){if(key!="tplan.v4"&&key!="secret")throw new ArgumentException("无效数据键");}
 public void Dispose(){if(db!=IntPtr.Zero){sqlite3_close(db);db=IntPtr.Zero;}}
}
