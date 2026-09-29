#import <UIKit/UIKit.h>

@interface LedovaSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (nonatomic, strong) UIWindow *window;
@end

static id<UIApplicationDelegate> LedovaApplicationDelegate(SEL selector)
{
  id<UIApplicationDelegate> delegate = UIApplication.sharedApplication.delegate;
  return [delegate respondsToSelector:selector] ? delegate : nil;
}

@implementation LedovaSceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions
{
  if (![scene isKindOfClass:[UIWindowScene class]] ||
      ![session.role isEqualToString:UIWindowSceneSessionRoleApplication]) {
    return;
  }
  self.window = [LedovaApplicationDelegate(@selector(window)) window];
  self.window.windowScene = (UIWindowScene *)scene;
  [self.window makeKeyAndVisible];
  [NSNotificationCenter.defaultCenter addObserver:self
                                         selector:@selector(windowDidBecomeVisible:)
                                             name:UIWindowDidBecomeVisibleNotification
                                           object:nil];
  [self scene:scene openURLContexts:connectionOptions.URLContexts];
  for (NSUserActivity *userActivity in connectionOptions.userActivities) {
    [self scene:scene continueUserActivity:userActivity];
  }
}

- (void)windowDidBecomeVisible:(NSNotification *)notification
{
  UIWindow *window = notification.object;
  if (window.windowScene == nil) {
    window.windowScene = self.window.windowScene;
  }
}

- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
  for (UIOpenURLContext *context in URLContexts) {
    NSMutableDictionary<UIApplicationOpenURLOptionsKey, id> *options = [NSMutableDictionary dictionary];
    options[UIApplicationOpenURLOptionsSourceApplicationKey] = context.options.sourceApplication;
    options[UIApplicationOpenURLOptionsAnnotationKey] = context.options.annotation;
    options[UIApplicationOpenURLOptionsOpenInPlaceKey] = @(context.options.openInPlace);
    [LedovaApplicationDelegate(@selector(application:openURL:options:)) application:UIApplication.sharedApplication
                                                                             openURL:context.URL
                                                                             options:options];
  }
}

- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)userActivity
{
  [LedovaApplicationDelegate(@selector(application:continueUserActivity:restorationHandler:))
             application:UIApplication.sharedApplication
    continueUserActivity:userActivity
      restorationHandler:^(NSArray<id<UIUserActivityRestoring>> *restorableObjects){
      }];
}

- (void)sceneWillEnterForeground:(UIScene *)scene
{
  [LedovaApplicationDelegate(@selector(applicationWillEnterForeground:))
      applicationWillEnterForeground:UIApplication.sharedApplication];
}

- (void)sceneDidBecomeActive:(UIScene *)scene
{
  [LedovaApplicationDelegate(@selector(applicationDidBecomeActive:))
      applicationDidBecomeActive:UIApplication.sharedApplication];
}

- (void)sceneWillResignActive:(UIScene *)scene
{
  [LedovaApplicationDelegate(@selector(applicationWillResignActive:))
      applicationWillResignActive:UIApplication.sharedApplication];
}

- (void)sceneDidEnterBackground:(UIScene *)scene
{
  [LedovaApplicationDelegate(@selector(applicationDidEnterBackground:))
      applicationDidEnterBackground:UIApplication.sharedApplication];
}

@end
