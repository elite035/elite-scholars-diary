package pk.edu.elitescholars.diary;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity {
  private static final String ORIGIN="https://diary.elitescholars.edu.pk";
  private static final int SAVE=1001, PICK=1002, MAX_FILE=20*1024*1024;
  private WebView web, printWeb;
  private ProgressBar progress;
  private LinearLayout offline;
  private ValueCallback<Uri[]> fileChooser;
  private byte[] pendingFile;
  private String pendingOperation;
  private String supportJs, lastUrl=ORIGIN+"/";
  private volatile boolean trustedPage=false;
  private final AtomicBoolean exporting=new AtomicBoolean(false);

  private boolean trusted(String url) {
    if(url==null)return false;
    Uri uri=Uri.parse(url);
    return "https".equalsIgnoreCase(uri.getScheme()) && "diary.elitescholars.edu.pk".equalsIgnoreCase(uri.getHost()) && (uri.getPort()==-1||uri.getPort()==443) && uri.getUserInfo()==null;
  }
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.rgb(246,243,237));
    root.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
    progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);root.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));
    web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));
    offline=new LinearLayout(this);offline.setOrientation(LinearLayout.VERTICAL);offline.setGravity(android.view.Gravity.CENTER);offline.setPadding(dp(28),dp(28),dp(28),dp(28));
    TextView message=new TextView(this);message.setText("Unable to connect\n\nCheck your internet connection, then try again.");message.setTextColor(Color.rgb(79,37,38));message.setTextSize(18);message.setGravity(android.view.Gravity.CENTER);offline.addView(message);
    Button retry=new Button(this);retry.setText("Try again");retry.setOnClickListener(v->{offline.setVisibility(View.GONE);web.setVisibility(View.VISIBLE);web.loadUrl(trusted(lastUrl)?lastUrl:ORIGIN+"/");});offline.addView(retry);offline.setVisibility(View.GONE);root.addView(offline,new LinearLayout.LayoutParams(-1,0,1));
    setContentView(root);
    try(InputStream in=getAssets().open("native-support.js")){supportJs=new String(readAll(in,256*1024),java.nio.charset.StandardCharsets.UTF_8);}catch(IOException error){supportJs="";}
    WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSafeBrowsingEnabled(true);settings.setMediaPlaybackRequiresUserGesture(true);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setUserAgentString(settings.getUserAgentString()+" EliteScholarsAndroid/1.0");
    CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
    web.addJavascriptInterface(new Bridge(),"EliteNative");
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){String url=request.getUrl().toString();if(trusted(url))return false;if(request.isForMainFrame())openExternal(url);return true;}
      @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){String url=request.getUrl().toString();if(trusted(url)||url.startsWith("blob:")||url.startsWith("data:")||url.equals("about:blank"))return null;return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
      @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){trustedPage=trusted(url);if(trusted(url)){lastUrl=url;progress.setVisibility(View.VISIBLE);}}
      @Override public void onPageFinished(WebView view,String url){progress.setVisibility(View.GONE);if(trusted(url)){view.evaluateJavascript(supportJs,null);CookieManager.getInstance().flush();}}
      @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showOffline();}
      @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){if(request.isForMainFrame()&&response.getStatusCode()>=500)showOffline();}
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public void onProgressChanged(WebView view,int value){progress.setProgress(value);}
      @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(fileChooser!=null)fileChooser.onReceiveValue(null);fileChooser=callback;try{startActivityForResult(params.createIntent(),PICK);}catch(ActivityNotFoundException error){fileChooser.onReceiveValue(null);fileChooser=null;notice("No file picker is installed on this device.");}return true;}
    });
    web.setDownloadListener((url,agent,disposition,mime,length)->download(url,mime,URLUtil.guessFileName(url,disposition,mime)));
    if(state!=null)web.restoreState(state);else web.loadUrl(ORIGIN+"/");
  }
  private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
  private void showOffline(){runOnUiThread(()->{progress.setVisibility(View.GONE);web.setVisibility(View.GONE);offline.setVisibility(View.VISIBLE);});}
  private void openExternal(String url){Uri uri=Uri.parse(url);String scheme=uri.getScheme();if(!("https".equals(scheme)||"mailto".equals(scheme)||"tel".equals(scheme)))return;try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(ActivityNotFoundException error){notice("No application can open this link.");}}
  private void notice(String text){runOnUiThread(()->Toast.makeText(this,text,Toast.LENGTH_LONG).show());}
  private static byte[] readAll(InputStream stream,int maximum)throws IOException{ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[16384];int n;while((n=stream.read(buffer))!=-1){if(bytes.size()+n>maximum)throw new IOException("File is too large");bytes.write(buffer,0,n);}return bytes.toByteArray();}
  private boolean allowedMime(String mime){return "application/zip".equals(mime)||"application/pdf".equals(mime)||"image/png".equals(mime)||"image/jpeg".equals(mime);}
  private void completeSave(String operation,boolean ok,String error){
    if(operation==null)return;
    runOnUiThread(()->{if(!trustedPage||!trusted(web.getUrl()))return;String payload="{\"id\":"+org.json.JSONObject.quote(operation)+",\"ok\":"+ok+",\"error\":"+org.json.JSONObject.quote(error==null?"":error)+"}";web.evaluateJavascript("window.dispatchEvent(new CustomEvent('elite-native-save',{detail:"+payload+"}));",null);});
  }
  private void save(byte[] bytes,String mime,String filename){
    runOnUiThread(()->{pendingFile=bytes;String safe=filename==null?"School_Diary":filename.replaceAll("[^a-zA-Z0-9_ .-]","_");if(safe.length()>150)safe=safe.substring(safe.length()-150);Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(mime);intent.putExtra(Intent.EXTRA_TITLE,safe);try{startActivityForResult(intent,SAVE);}catch(ActivityNotFoundException error){pendingFile=null;String operation=pendingOperation;pendingOperation=null;exporting.set(false);completeSave(operation,false,"No file saving app is installed.");notice("No file saving app is installed.");}});
  }
  private void download(String url,String mime,String filename){
    if(!trusted(url)||!trusted(web.getUrl())||!allowedMime(mime)){notice("This download is not supported. Open the diary in your browser if needed.");return;}
    if(!exporting.compareAndSet(false,true)){notice("Finish or cancel the current download first.");return;}
    String cookie=CookieManager.getInstance().getCookie(url);
    new Thread(()->{try{HttpsURLConnection connection=(HttpsURLConnection)new URL(url).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(20000);connection.setReadTimeout(30000);if(cookie!=null)connection.setRequestProperty("Cookie",cookie);try{if(connection.getResponseCode()!=200)throw new IOException("Download failed");try(InputStream in=connection.getInputStream()){save(readAll(in,MAX_FILE),mime,filename);}}finally{connection.disconnect();}}catch(Exception error){exporting.set(false);notice("Unable to download this file. Please try again.");}},"SchoolDiaryDownload").start();
  }
  private final class Bridge {
    @JavascriptInterface public boolean supportsArchiveDownloads(){return trustedPage;}
    @JavascriptInterface public void saveFile(String filename,String mime,String encoded){saveFileWithResult(filename,mime,encoded,null);}
    @JavascriptInterface public void saveFileWithResult(String filename,String mime,String encoded,String operation){
      if(operation!=null&&!operation.matches("[a-zA-Z0-9-]{1,80}"))return;
      if(!trustedPage||!allowedMime(mime)||encoded==null||encoded.length()>28*1024*1024){completeSave(operation,false,"Unsupported or oversized diary export.");return;}
      if(!exporting.compareAndSet(false,true)){completeSave(operation,false,"Finish or cancel the current download first.");return;}
      pendingOperation=operation;
      new Thread(()->{try{byte[] bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);if(bytes.length>MAX_FILE)throw new IllegalArgumentException();save(bytes,mime,filename);}catch(Exception error){pendingOperation=null;exporting.set(false);completeSave(operation,false,"Unable to prepare the export. Please try again.");}},"SchoolDiaryPrepare").start();
    }
    @JavascriptInterface public void printDocument(String html){
      if(!trustedPage||html==null||html.length()>4*1024*1024)return;
      runOnUiThread(()->{
        if(printWeb!=null){notice("A print job is already being prepared.");return;}
        printWeb=new WebView(MainActivity.this);printWeb.getSettings().setJavaScriptEnabled(false);printWeb.getSettings().setAllowFileAccess(false);printWeb.getSettings().setAllowContentAccess(false);printWeb.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        printWeb.setWebViewClient(new WebViewClient(){
          @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return trusted(request.getUrl().toString())?null:new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
          private boolean started=false;
          @Override public void onPageFinished(WebView view,String url){if(started)return;started=true;try{PrintManager manager=(PrintManager)getSystemService(PRINT_SERVICE);final android.print.PrintDocumentAdapter original=view.createPrintDocumentAdapter("Class diary");android.print.PrintDocumentAdapter adapter=new android.print.PrintDocumentAdapter(){
            @Override public void onStart(){original.onStart();}
            @Override public void onLayout(PrintAttributes oldAttrs,PrintAttributes newAttrs,android.os.CancellationSignal signal,LayoutResultCallback callback,Bundle extras){original.onLayout(oldAttrs,newAttrs,signal,callback,extras);}
            @Override public void onWrite(android.print.PageRange[] pages,android.os.ParcelFileDescriptor destination,android.os.CancellationSignal signal,WriteResultCallback callback){original.onWrite(pages,destination,signal,callback);}
            @Override public void onFinish(){try{original.onFinish();}finally{view.destroy();if(printWeb==view)printWeb=null;}}
          };manager.print("Elite Scholars Class Diary",adapter,new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).setColorMode(PrintAttributes.COLOR_MODE_COLOR).build());}catch(Exception error){view.destroy();if(printWeb==view)printWeb=null;notice("Printing is unavailable. Download the PDF instead.");}}
        });
        printWeb.loadDataWithBaseURL(ORIGIN+"/",html,"text/html","UTF-8",null);
      });
    }
  }
  @Override protected void onActivityResult(int request,int result,Intent intent){super.onActivityResult(request,result,intent);if(request==PICK&&fileChooser!=null){fileChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,intent));fileChooser=null;}if(request==SAVE){final byte[] bytes=pendingFile;pendingFile=null;final String operation=pendingOperation;pendingOperation=null;
    if(result!=RESULT_OK||intent==null||intent.getData()==null||bytes==null){exporting.set(false);completeSave(operation,false,"Diary download was cancelled.");return;}
    final Uri destination=intent.getData();new Thread(()->{try(OutputStream output=getContentResolver().openOutputStream(destination)){if(output==null)throw new IOException();output.write(bytes);output.flush();completeSave(operation,true,"");notice("Diary file saved.");}catch(IOException error){completeSave(operation,false,"Unable to save the file. Please try again.");notice("Unable to save the file. Please try again.");}finally{exporting.set(false);}},"SchoolDiarySave").start();
  }}
  @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);web.saveState(state);}
  @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
  @Override protected void onDestroy(){if(fileChooser!=null)fileChooser.onReceiveValue(null);if(printWeb!=null)printWeb.destroy();web.removeJavascriptInterface("EliteNative");web.destroy();super.onDestroy();}
}
