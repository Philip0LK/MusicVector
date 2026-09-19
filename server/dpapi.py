import ctypes,json,sys,base64
from ctypes import wintypes
class Blob(ctypes.Structure):
 _fields_=[("size",wintypes.DWORD),("data",ctypes.POINTER(ctypes.c_ubyte))]
def run(op,value):
 raw=value.encode("utf8") if op=="protect" else base64.b64decode(value)
 buf=ctypes.create_string_buffer(raw);source=Blob(len(raw),ctypes.cast(buf,ctypes.POINTER(ctypes.c_ubyte)));dest=Blob()
 crypt=ctypes.windll.crypt32
 args=[ctypes.byref(source),None,None,None,None,1,ctypes.byref(dest)]
 ok=(crypt.CryptProtectData if op=="protect" else crypt.CryptUnprotectData)(*args)
 if not ok:raise RuntimeError("Windows 无法解密此凭据，请重新填写密钥")
 try:
  out=ctypes.string_at(dest.data,dest.size)
  return base64.b64encode(out).decode("ascii") if op=="protect" else out.decode("utf8")
 finally:ctypes.windll.kernel32.LocalFree(dest.data)
try:
 v=json.load(sys.stdin);print(json.dumps({"value":run(v["op"],v["value"])}))
except Exception:
 print(json.dumps({"error":"凭据保护失败，请在当前 Windows 用户下重新填写密钥"}));sys.exit(1)

